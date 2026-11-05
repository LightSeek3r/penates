/**
 * Verifies the signed token Cloudflare Access adds to requests it has let through. Access already blocks
 * unauthenticated visitors at the edge; checking the token here as well keeps the data private even if
 * the Access application is misconfigured or removed. Anything unconfigured fails closed.
 */

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  /** Local development only; must never be set on the deployed project. */
  ADMIN_DEV_BYPASS?: string
}

interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
}

const JWKS_TTL_MS = 60 * 60 * 1000
let cache: { team: string; keys: Jwk[]; at: number } | null = null

const decoder = new TextDecoder()

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

const parseJson = (value: string) => JSON.parse(decoder.decode(base64UrlToBytes(value))) as Record<string, unknown>

async function signingKeys(team: string, fetcher: typeof fetch): Promise<Jwk[]> {
  if (cache && cache.team === team && Date.now() - cache.at < JWKS_TTL_MS) return cache.keys
  const response = await fetcher(`https://${team}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error(`Access keys unavailable: ${response.status}`)
  const keys = ((await response.json()) as { keys: Jwk[] }).keys
  cache = { team, keys, at: Date.now() }
  return keys
}

export function resetAccessKeyCache(): void {
  cache = null
}

export type AccessResult = { ok: true; email: string | null } | { ok: false; reason: string }

export async function verifyAccess(request: Request, env: AccessEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<AccessResult> {
  if (env.ADMIN_DEV_BYPASS === '1') return { ok: true, email: null }
  const team = env.ACCESS_TEAM_DOMAIN
  const audience = env.ACCESS_AUD
  if (!team || !audience) return { ok: false, reason: 'Access is not configured' }

  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  const parts = token?.split('.')
  if (!parts || parts.length !== 3) return { ok: false, reason: 'No Access token' }

  try {
    const header = parseJson(parts[0])
    const claims = parseJson(parts[1])
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return { ok: false, reason: 'Unsupported token' }

    const jwk = (await signingKeys(team, fetcher)).find((key) => key.kid === header.kid)
    if (!jwk) return { ok: false, reason: 'Unknown signing key' }
    const key = await crypto.subtle.importKey('jwk', jwk as JsonWebKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
    if (!valid) return { ok: false, reason: 'Bad signature' }

    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audiences.includes(audience)) return { ok: false, reason: 'Wrong audience' }
    if (claims.iss !== `https://${team}`) return { ok: false, reason: 'Wrong issuer' }
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return { ok: false, reason: 'Expired' }
    return { ok: true, email: typeof claims.email === 'string' ? claims.email : null }
  } catch {
    return { ok: false, reason: 'Invalid token' }
  }
}
