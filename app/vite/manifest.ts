import type { Lang } from './seo-content.ts'

const COPY = {
  fr: {
    name: "settling-map : prix de l'immobilier en France",
    description: "Prix de vente médian au m² par commune en France, avec la fiabilité de chaque chiffre.",
    start_url: '/',
    lang: 'fr',
    wideLabel: 'La carte des prix sur ordinateur',
    narrowLabel: 'La carte des prix sur téléphone',
    shortcut: 'English',
    shortcutUrl: '/en/',
  },
  en: {
    name: 'settling-map: French property prices',
    description: 'Median sale price per m² by commune in France, with how reliable each figure is.',
    start_url: '/en/',
    lang: 'en',
    wideLabel: 'The price map on a computer',
    narrowLabel: 'The price map on a phone',
    shortcut: 'Français',
    shortcutUrl: '/',
  },
} as const

export function webManifest(lang: Lang) {
  const copy = COPY[lang]
  return {
    id: copy.start_url,
    name: copy.name,
    short_name: 'settling-map',
    description: copy.description,
    lang: copy.lang,
    dir: 'ltr',
    start_url: copy.start_url,
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: '#0B1B3A',
    theme_color: '#0B1B3A',
    categories: ['utilities', 'navigation'],
    icons: [
      { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    screenshots: [
      { src: '/screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: copy.wideLabel },
      { src: '/screenshots/narrow.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: copy.narrowLabel },
    ],
    shortcuts: [{ name: copy.shortcut, short_name: copy.shortcut, url: copy.shortcutUrl, icons: [{ src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' }] }],
  }
}
