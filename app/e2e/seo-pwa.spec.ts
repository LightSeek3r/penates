import { expect, test, type Page } from '@playwright/test'
import { mapReady } from './helpers'

const SITE = 'https://settling.unit42.fr'

async function rawHtml(page: Page, path: string): Promise<string> {
  const response = await page.request.get(path)
  expect(response.status(), path).toBe(200)
  return response.text()
}

test.describe('search engines see real, per-language pages', () => {
  test('the French page declares itself, its alternates and structured data', async ({ page }) => {
    const html = await rawHtml(page, '/')
    expect(html).toContain('<html lang="fr">')
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`)
    expect(html).toContain(`hreflang="en" href="${SITE}/en/"`)
    expect(html).toContain('property="og:image"')
    expect(html.match(/<h1>/g)).toHaveLength(1)
    expect(html).toContain('Prix de l&#39;immobilier'.replace('&#39;', "'"))
    const jsonLd = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)?.[1] ?? ''
    expect(JSON.parse(jsonLd)['@graph'].map((node: { '@type': string }) => node['@type'])).toEqual(['WebSite', 'WebApplication'])
  })

  test('the English page is a separate URL in English', async ({ page }) => {
    const html = await rawHtml(page, '/en/')
    expect(html).toContain('<html lang="en">')
    expect(html).toContain(`<link rel="canonical" href="${SITE}/en/" />`)
    expect(html).toContain('<title>French property prices by commune')
    expect(html).toContain('rel="manifest" href="/manifest.en.webmanifest"')
  })

  test('documentation pages exist in both languages and link to each other', async ({ page }) => {
    for (const [path, title, other] of [
      ['/methodologie/', 'Méthode', '/en/methodology/'],
      ['/en/methodology/', 'Method', '/methodologie/'],
      ['/sources/', 'Sources', '/en/sources/'],
      ['/en/sources/', 'sources', '/sources/'],
    ] as const) {
      const html = await rawHtml(page, path)
      expect(html, path).toContain(title)
      expect(html, path).toContain(`href="${other}"`)
      expect(html, path).toContain('BreadcrumbList')
    }
  })

  test('robots.txt and sitemap.xml are served', async ({ page }) => {
    expect(await rawHtml(page, '/robots.txt')).toContain(`Sitemap: ${SITE}/sitemap.xml`)
    const sitemap = await rawHtml(page, '/sitemap.xml')
    for (const path of ['/', '/en/', '/methodologie/', '/en/methodology/', '/sources/', '/en/sources/']) {
      expect(sitemap).toContain(`<loc>${SITE}${path}</loc>`)
    }
  })

  test('the legal notice is only listed when it exists', async ({ page }) => {
    const sitemap = await rawHtml(page, '/sitemap.xml')
    const listed = sitemap.includes('mentions-legales')
    const html = await (await page.request.get('/mentions-legales/')).text()
    // The preview server answers unknown paths with the app, so presence is judged by the page itself.
    expect(html.includes('Mentions légales et confidentialité')).toBe(listed)
  })
})

test.describe('language routing', () => {
  test('the toggle moves between / and /en/ and keeps the map position', async ({ page }) => {
    await page.goto('/#z=8&lat=45.76&lng=4.84')
    await mapReady(page)
    await page.getByRole('link', { name: 'English' }).click()
    await expect(page).toHaveURL(/\/en\/#.*z=8/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await mapReady(page)
    await page.getByRole('link', { name: 'Français' }).click()
    await expect(page).toHaveURL(/\/#.*z=8/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  })

  test('an old link with l=en in the hash lands on the English page', async ({ page }) => {
    await page.goto('/#z=6&lat=46&lng=2&l=en')
    await expect(page).toHaveURL(/\/en\//)
  })
})

test.describe('installable app', () => {
  test('each language links a valid manifest whose icons resolve', async ({ page }) => {
    for (const [path, manifestPath, startUrl] of [
      ['/', '/manifest.webmanifest', '/'],
      ['/en/', '/manifest.en.webmanifest', '/en/'],
    ] as const) {
      await page.goto(path)
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', manifestPath)
      const manifest = await (await page.request.get(manifestPath)).json()
      expect(manifest.start_url).toBe(startUrl)
      expect(manifest.display).toBe('standalone')
      expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(true)
      for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok(), icon.src).toBe(true)
    }
  })

  test('Chromium finds no installability problem', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'installability is a Chromium check')
    await page.goto('/')
    await mapReady(page)
    await page.evaluate(() => navigator.serviceWorker.ready)
    const session = await page.context().newCDPSession(page)
    const { installabilityErrors } = await session.send('Page.getInstallabilityErrors')
    expect(installabilityErrors).toEqual([])
  })

  test('the service worker takes control and the shell opens offline', async ({ page, context }) => {
    await page.goto('/')
    await mapReady(page)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByText('Hors ligne')).toBeVisible()
    await context.setOffline(false)
  })
})

test.describe('security headers', () => {
  test('the page ships a CSP and the map still loads under it', async ({ page }) => {
    const violations: string[] = []
    page.on('console', (message) => {
      if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text())
    })
    const response = await page.goto('/')
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
    expect(response?.headers()['x-content-type-options']).toBe('nosniff')
    await mapReady(page)
    await page.waitForTimeout(1500)
    expect(violations).toEqual([])
  })
})
