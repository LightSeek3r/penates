import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { headersFile, securityHeaders } from './headers'
import { webManifest } from './manifest'
import {
  type Lang,
  type PageId,
  type SeoContent,
  docPageHtml,
  headTags,
  landingBody,
  landingJsonLd,
  landingPath,
  pagePath,
  robotsTxt,
  sitemapXml,
} from './seo-content'

const load = (lang: Lang): SeoContent => JSON.parse(readFileSync(new URL(`../content/seo.${lang}.json`, import.meta.url), 'utf8'))
const content = { fr: load('fr'), en: load('en') }
const locale = { fr: content.fr.locale, en: content.en.locale }
const PAGES: PageId[] = ['methodology', 'sources']

function head(lang: Lang) {
  return headTags({
    lang,
    title: content[lang].title,
    description: content[lang].description,
    path: landingPath(lang),
    alternates: { fr: '/', en: '/en/' },
    locale,
    jsonLd: landingJsonLd(lang, content[lang]),
  })
}

describe('landing head', () => {
  it.each(['fr', 'en'] as const)('has a complete, self-consistent head in %s', (lang) => {
    const html = head(lang)
    const canonical = lang === 'fr' ? 'https://penates.unit42.fr/' : 'https://penates.unit42.fr/en/'
    expect(html).toContain(`<link rel="canonical" href="${canonical}" />`)
    expect(html).toContain('hreflang="fr" href="https://penates.unit42.fr/"')
    expect(html).toContain('hreflang="en" href="https://penates.unit42.fr/en/"')
    expect(html).toContain('hreflang="x-default" href="https://penates.unit42.fr/"')
    expect(html).toContain(`property="og:image" content="https://penates.unit42.fr/og-image-${lang}.png"`)
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  it('keeps titles and descriptions within search-result limits', () => {
    for (const lang of ['fr', 'en'] as const) {
      expect(content[lang].title.length).toBeLessThanOrEqual(65)
      expect(content[lang].description.length).toBeGreaterThanOrEqual(110)
      expect(content[lang].description.length).toBeLessThanOrEqual(165)
    }
  })

  it('emits parseable JSON-LD and escapes markup in text', () => {
    const html = headTags({ lang: 'en', title: 'A "quoted" <b>title</b>', description: 'd', path: '/en/', alternates: { fr: '/', en: '/en/' }, locale, jsonLd: { name: '</script><b>' } })
    expect(html).toContain('A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt;')
    expect(html).not.toContain('</script><b>')
    const json = /<script type="application\/ld\+json">(.*)<\/script>/.exec(head('fr'))?.[1]
    expect(() => JSON.parse(json ?? '')).not.toThrow()
  })
})

describe('crawlable body', () => {
  it.each(['fr', 'en'] as const)('has one h1 and links to the documentation pages in %s', (lang) => {
    const html = landingBody(lang, content[lang], PAGES)
    expect(html.match(/<h1>/g)).toHaveLength(1)
    expect(html).toContain(`href="${pagePath(lang, content[lang], 'methodology')}"`)
    expect(html).toContain(`href="${pagePath(lang, content[lang], 'sources')}"`)
  })

  it('does not link a page that does not exist', () => {
    expect(landingBody('fr', content.fr, PAGES)).not.toContain('mentions-legales')
  })
})

describe('documentation pages', () => {
  it('declare language, alternates and breadcrumbs', () => {
    const html = docPageHtml({ lang: 'fr', content: content.fr, page: 'methodology', bodyHtml: '<h1>x</h1>', pages: PAGES, alternatePath: '/en/methodology/', locale })
    expect(html).toContain('<html lang="fr">')
    expect(html).toContain('hreflang="en" href="https://penates.unit42.fr/en/methodology/"')
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toContain('aria-current="page"')
  })
})

describe('sitemap and robots', () => {
  it('lists every page in both languages with alternates', () => {
    const xml = sitemapXml([{ fr: '/', en: '/en/' }, { fr: '/methodologie/', en: '/en/methodology/' }])
    expect(xml.match(/<url>/g)).toHaveLength(4)
    expect(xml).toContain('<loc>https://penates.unit42.fr/en/methodology/</loc>')
    expect(xml).toContain('hreflang="x-default" href="https://penates.unit42.fr/methodologie/"')
  })

  it('allows crawling and points to the sitemap', () => {
    expect(robotsTxt()).toContain('Allow: /')
    expect(robotsTxt()).toContain('Disallow: /admin/')
    expect(robotsTxt()).toContain('Disallow: /api/')
    expect(robotsTxt()).toContain('Sitemap: https://penates.unit42.fr/sitemap.xml')
  })
})

describe('security headers', () => {
  it('allow only the hosts the app talks to, and no eval', () => {
    const csp = securityHeaders('https://settling-tiles.unit42.fr')['Content-Security-Policy']
    expect(csp).toContain('connect-src')
    expect(csp).toContain('https://settling-tiles.unit42.fr')
    expect(csp).toContain('https://tiles.openfreemap.org')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  it('follows the data host used by the build', () => {
    expect(securityHeaders('http://localhost:8788')['Content-Security-Policy']).toContain('http://localhost:8788')
  })

  it('caches hashed assets forever and never the service worker', () => {
    const file = headersFile(undefined)
    expect(file).toMatch(/\/assets\/\*\n  Cache-Control: public, max-age=31536000, immutable/)
    expect(file).toMatch(/\/sw\.js\n  Cache-Control: no-cache/)
  })
})

describe('web manifest', () => {
  it.each(['fr', 'en'] as const)('is installable in %s', (lang) => {
    const manifest = webManifest(lang)
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((icon) => 'purpose' in icon && icon.purpose === 'maskable')).toBe(true)
    expect(manifest.lang).toBe(lang)
  })

  it('offers install screenshots for both form factors', () => {
    expect(webManifest('fr').screenshots.map((shot) => shot.form_factor)).toEqual(['wide', 'narrow'])
  })

  it('starts each language on its own page', () => {
    expect(webManifest('fr').start_url).toBe('/')
    expect(webManifest('en').start_url).toBe('/en/')
  })
})
