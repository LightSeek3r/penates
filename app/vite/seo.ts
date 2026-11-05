import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'
import type { Plugin } from 'vite'
import { headersFile } from './headers.ts'
import { webManifest } from './manifest.ts'
import {
  LANGS,
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
} from './seo-content.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = resolve(ROOT, '../docs')

const PAGE_SOURCES: Record<PageId, Record<Lang, string>> = {
  methodology: { fr: 'methodology.fr.md', en: 'methodology.md' },
  sources: { fr: 'data-licences.fr.md', en: 'data-licences.md' },
  legal: { fr: 'legal.fr.md', en: 'legal.md' },
}

const load = (lang: Lang): SeoContent => JSON.parse(readFileSync(resolve(ROOT, `content/seo.${lang}.json`), 'utf8'))

/** Pages whose markdown exists in both languages; the legal notice only appears once the publisher has supplied it. */
function availablePages(): PageId[] {
  return (Object.keys(PAGE_SOURCES) as PageId[]).filter((page) => LANGS.every((lang) => existsSync(resolve(DOCS, PAGE_SOURCES[page][lang]))))
}

const langOf = (path: string): Lang => (path.startsWith('/en') ? 'en' : 'fr')

export function seoPlugin(dataBase: string | undefined): Plugin {
  const contents = { fr: load('fr'), en: load('en') }
  const locale = { fr: contents.fr.locale, en: contents.en.locale }
  const markdown = new MarkdownIt({ html: false, linkify: true })

  const seo: Plugin = {
    name: 'settling-seo',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const lang = langOf(ctx.path)
        const content = contents[lang]
        const alternates = { fr: landingPath('fr'), en: landingPath('en') }
        const head = headTags({
          lang,
          title: content.title,
          description: content.description,
          path: landingPath(lang),
          alternates,
          locale,
          jsonLd: landingJsonLd(lang, content),
        })
        return html.replace('<!--seo-head-->', head).replace('<!--seo-body-->', landingBody(lang, content, availablePages())).replace(/<html lang="[a-z]+"/, `<html lang="${lang}"`)
      },
    },
    generateBundle() {
      const pages = availablePages()
      for (const page of pages) {
        for (const lang of LANGS) {
          const other: Lang = lang === 'fr' ? 'en' : 'fr'
          const content = contents[lang]
          const bodyHtml = markdown.render(readFileSync(resolve(DOCS, PAGE_SOURCES[page][lang]), 'utf8'))
          const source = docPageHtml({
            lang,
            content,
            page,
            bodyHtml,
            pages,
            alternatePath: pagePath(other, contents[other], page),
            locale,
          })
          this.emitFile({ type: 'asset', fileName: `${pagePath(lang, content, page).slice(1)}index.html`, source })
        }
      }
      const entries = [
        { fr: landingPath('fr'), en: landingPath('en') },
        ...pages.map((page) => ({ fr: pagePath('fr', contents.fr, page), en: pagePath('en', contents.en, page) })),
      ]
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(entries) })
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt() })
      this.emitFile({ type: 'asset', fileName: 'manifest.en.webmanifest', source: JSON.stringify(webManifest('en'), null, 2) })
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(dataBase) })
    },
  }

  return seo
}

// The English page links its own manifest (English name, start_url /en/). VitePWA injects the French link as a head tag
// after every string transform, so the swap happens on the written file, before the service worker precache is computed.
export function englishManifestPlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'settling-english-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      const file = resolve(outDir, 'en/index.html')
      writeFileSync(file, readFileSync(file, 'utf8').replace('/manifest.webmanifest', '/manifest.en.webmanifest'))
    },
  }
}
