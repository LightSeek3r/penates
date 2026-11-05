export type Lang = 'fr' | 'en'
export type PageId = 'methodology' | 'sources' | 'legal'

export interface PageCopy {
  slug: string
  label: string
  title: string
  description: string
}

export interface SeoContent {
  locale: string
  title: string
  description: string
  h1: string
  intro: string[]
  featuresTitle: string
  features: string[]
  openApp: string
  navTitle: string
  noscript: string
  home: string
  footer: string
  languageSwitch: string
  pages: Record<PageId, PageCopy>
}

export const SITE = 'https://settling.unit42.fr'
export const LANGS: readonly Lang[] = ['fr', 'en']

export const landingPath = (lang: Lang) => (lang === 'fr' ? '/' : '/en/')
export const pagePath = (lang: Lang, content: SeoContent, page: PageId) => `${landingPath(lang)}${content.pages[page].slug}/`
export const absolute = (path: string) => `${SITE}${path}`
export const imagePath = (lang: Lang) => `/og-image-${lang}.png`

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

interface HeadInput {
  lang: Lang
  title: string
  description: string
  path: string
  /** Path of the same page in each language. */
  alternates: Record<Lang, string>
  locale: Record<Lang, string>
  jsonLd?: unknown
}

export function headTags({ lang, title, description, path, alternates, locale, jsonLd }: HeadInput): string {
  const other: Lang = lang === 'fr' ? 'en' : 'fr'
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<link rel="canonical" href="${absolute(path)}" />`,
    `<link rel="alternate" hreflang="fr" href="${absolute(alternates.fr)}" />`,
    `<link rel="alternate" hreflang="en" href="${absolute(alternates.en)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${absolute(alternates.fr)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="settling-map" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:url" content="${absolute(path)}" />`,
    `<meta property="og:locale" content="${locale[lang]}" />`,
    `<meta property="og:locale:alternate" content="${locale[other]}" />`,
    `<meta property="og:image" content="${absolute(imagePath(lang))}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:image" content="${absolute(imagePath(lang))}" />`,
  ]
  if (jsonLd) lines.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`)
  return lines.join('\n    ')
}

export function landingJsonLd(lang: Lang, content: SeoContent) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'settling-map', inLanguage: ['fr', 'en'] },
      {
        '@type': 'WebApplication',
        '@id': `${absolute(landingPath(lang))}#app`,
        url: absolute(landingPath(lang)),
        name: 'settling-map',
        description: content.description,
        inLanguage: lang,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
        isPartOf: { '@id': `${SITE}/#website` },
      },
    ],
  }
}

export function pageJsonLd(lang: Lang, content: SeoContent, page: PageId, path: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${absolute(path)}#page`,
        url: absolute(path),
        name: content.pages[page].title,
        description: content.pages[page].description,
        inLanguage: lang,
        isPartOf: { '@id': `${SITE}/#website` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: content.home, item: absolute(landingPath(lang)) },
          { '@type': 'ListItem', position: 2, name: content.pages[page].label, item: absolute(path) },
        ],
      },
    ],
  }
}

/** Crawlable content placed inside #root; React replaces it when the app mounts. */
export function landingBody(lang: Lang, content: SeoContent, pages: readonly PageId[]): string {
  const links = pages.map((page) => `<li><a href="${pagePath(lang, content, page)}">${escapeHtml(content.pages[page].label)}</a></li>`).join('')
  return `<div class="seo-fallback">
      <main>
        <h1>${escapeHtml(content.h1)}</h1>
        ${content.intro.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('\n        ')}
        <h2>${escapeHtml(content.featuresTitle)}</h2>
        <ul>${content.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
        <noscript><p>${escapeHtml(content.noscript)}</p></noscript>
      </main>
      <nav aria-label="${escapeHtml(content.navTitle)}"><ul>${links}</ul></nav>
      <p>${escapeHtml(content.footer)}</p>
    </div>`
}

interface PageInput {
  lang: Lang
  content: SeoContent
  page: PageId
  bodyHtml: string
  pages: readonly PageId[]
  alternatePath: string
  locale: Record<Lang, string>
}

export function docPageHtml({ lang, content, page, bodyHtml, pages, alternatePath, locale }: PageInput): string {
  const path = pagePath(lang, content, page)
  const alternates = lang === 'fr' ? { fr: path, en: alternatePath } : { fr: alternatePath, en: path }
  const copy = content.pages[page]
  const nav = pages
    .map((candidate) => `<a href="${pagePath(lang, content, candidate)}"${candidate === page ? ' aria-current="page"' : ''}>${escapeHtml(content.pages[candidate].label)}</a>`)
    .join('')
  const head = headTags({ lang, title: copy.title, description: copy.description, path, alternates, locale, jsonLd: pageJsonLd(lang, content, page, path) })
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#0B1B3A" />
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon-180x180.png" />
    <link rel="stylesheet" href="/pages.css" />
    ${head}
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="${landingPath(lang)}">settling-map</a>
      <nav aria-label="${escapeHtml(content.navTitle)}">${nav}</nav>
      <a class="lang" href="${alternatePath}" hreflang="${lang === 'fr' ? 'en' : 'fr'}" lang="${lang === 'fr' ? 'en' : 'fr'}">${escapeHtml(content.languageSwitch)}</a>
    </header>
    <main class="doc">
      ${bodyHtml}
      <p class="back"><a href="${landingPath(lang)}">${escapeHtml(content.openApp)}</a></p>
    </main>
    <footer class="site-footer"><p>${escapeHtml(content.footer)}</p></footer>
  </body>
</html>
`
}

export function sitemapXml(entries: ReadonlyArray<Record<Lang, string>>): string {
  const alternates = (entry: Record<Lang, string>) =>
    [
      `<xhtml:link rel="alternate" hreflang="fr" href="${absolute(entry.fr)}"/>`,
      `<xhtml:link rel="alternate" hreflang="en" href="${absolute(entry.en)}"/>`,
      `<xhtml:link rel="alternate" hreflang="x-default" href="${absolute(entry.fr)}"/>`,
    ].join('')
  const urls = entries.flatMap((entry) => LANGS.map((lang) => `<url><loc>${absolute(entry[lang])}</loc>${alternates(entry)}</url>`))
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>\n`
}

export function robotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`
}
