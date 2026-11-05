// Renders the social-share images and the install-dialog screenshots from a running production build.
// usage: node scripts/capture-social.mjs http://localhost:4180   (the data server must also be running)
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://localhost:4180'
const browser = await chromium.launch()

async function capture(path, file, { width, height }, { cleanCard = false, wait = 7000 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } })
  await page.goto(`${base}${path}`)
  await page.locator('main[data-map-status=ready]').waitFor({ timeout: 30_000 })
  if (cleanCard) await page.addStyleTag({ content: '.controls, .stage__right { display: none !important }' })
  await page.waitForTimeout(wait)
  await page.screenshot({ path: `public/${file}` })
  await page.close()
}

// Share cards show the map and legend only; the install screenshots keep the whole interface.
await capture('/', 'og-image-fr.png', { width: 1200, height: 630 }, { cleanCard: true })
await capture('/en/', 'og-image-en.png', { width: 1200, height: 630 }, { cleanCard: true })
await capture('/', 'screenshots/wide.png', { width: 1280, height: 720 })
await capture('/', 'screenshots/narrow.png', { width: 390, height: 844 })
await browser.close()
