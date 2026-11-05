const origin = (value: string | undefined, fallback: string) => new URL(value ?? fallback).origin

/** Content-Security-Policy and friends, shared by the deployed `_headers` file and the local preview server. */
export function securityHeaders(dataBase: string | undefined): Record<string, string> {
  const data = origin(dataBase, 'https://settling-tiles.unit42.fr')
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://tiles.openfreemap.org",
    "font-src 'self' data:",
    `connect-src 'self' ${data} https://tiles.openfreemap.org https://geo.api.gouv.fr`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  }
}

/** Cloudflare Pages `_headers` file: security headers everywhere, plus the cache policy. */
export function headersFile(dataBase: string | undefined): string {
  const block = (path: string, headers: Record<string, string>) =>
    `${path}\n${Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`
  return [
    block('/*', securityHeaders(dataBase)),
    block('/assets/*', { 'Cache-Control': 'public, max-age=31536000, immutable' }),
    block('/sw.js', { 'Cache-Control': 'no-cache' }),
    block('/manifest.webmanifest', { 'Cache-Control': 'public, max-age=3600' }),
    block('/manifest.en.webmanifest', { 'Cache-Control': 'public, max-age=3600' }),
    block('/*.png', { 'Cache-Control': 'public, max-age=86400' }),
    block('/*.svg', { 'Cache-Control': 'public, max-age=86400' }),
  ].join('\n')
}
