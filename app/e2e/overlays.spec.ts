import { expect, test, type Page } from '@playwright/test'
import { hasRiskLines, mapReady, openGroup, openLayersOnPhone, overlayManifest } from './helpers'

// The host injects an analytics snippet on the deployed site that the CSP blocks on purpose (see seo-pwa.spec.ts).
const injectedByHost = process.env.E2E_BASE_URL ? /cloudflareinsights|Executing inline script/ : /(?!)/

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !injectedByHost.test(message.text())) errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 720
const overlaysInLink = (page: Page) => (new URLSearchParams(new URL(page.url()).hash.slice(1)).get('ov') ?? '').split(',').filter(Boolean)
const overlaysTab = (page: Page) => page.getByRole('tab', { name: /^Calques/ })
const seismic = (page: Page) => page.getByRole('checkbox', { name: 'Limites des zones sismiques' })
const hospitals = (page: Page) => page.getByRole('checkbox', { name: 'Hôpitaux et cliniques' })
const keyHead = (page: Page) => page.locator('.ov-key summary')
const RISK_NAMES = { flood: "Inondation : démarches de l'État", clay: 'Retrait-gonflement des argiles', radon: 'Radon', cavities: 'Cavités souterraines' } as const

test.beforeEach(async () => {
  const manifest = await overlayManifest()
  test.skip(!manifest?.layers?.seismic || !manifest.layers.places, 'the data host serves no overlays archive with seismic lines and places yet')
})

test('a risk and a place overlay go on over price, are shared in the link, keyed in the legend and cleared', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await overlaysTab(page).click()
  await expect(overlaysTab(page)).toHaveAttribute('aria-selected', 'true')
  // Nothing is on by default.
  await expect(page.getByRole('button', { name: 'Retirer les calques' })).toBeDisabled()
  expect(overlaysInLink(page)).toEqual([])

  await openGroup(page, 'Risques naturels')
  await seismic(page).check()
  await openGroup(page, 'Santé')
  await hospitals(page).check()
  await expect(hospitals(page)).toBeChecked()
  // Opening the health group closed the risk group, but its overlay stays on and its count shows on the heading.
  await expect(page.locator('summary', { hasText: 'Risques naturels' })).toContainText('1')
  await expect(overlaysTab(page)).toContainText('2')
  await expect.poll(() => overlaysInLink(page).sort()).toEqual(['hos', 'seismic'])
  // The colour stays price: overlays are drawn over it, not instead of it.
  await expect(page).not.toHaveURL(/th=/)

  const legend = page.getByRole('region', { name: 'Prix médian, €/m²' })
  if (isPhone(page)) await page.getByRole('button', { name: 'Fermer', exact: true }).click()
  await expect(keyHead(page)).toHaveText(/Calques \(2\)/)
  if (isPhone(page)) {
    // On phones the key starts folded as a chip in the strip.
    await expect(legend.getByText('Hôpitaux et cliniques')).toBeHidden()
    await keyHead(page).click()
  }
  await expect(legend.getByText('Hôpitaux et cliniques')).toBeVisible()
  await expect(legend.getByText('Passage en zone 3')).toBeVisible()
  await expect(legend.getByText(/Une ligne marque le passage de la valeur/)).toBeVisible()

  await page.reload()
  await mapReady(page)
  await expect(keyHead(page)).toHaveText(/Calques \(2\)/)
  await openLayersOnPhone(page)
  await overlaysTab(page).click()
  // The group holding an overlay that is on opens by itself.
  await expect(seismic(page)).toBeChecked()

  await page.getByRole('button', { name: 'Retirer les calques' }).click()
  await expect(seismic(page)).not.toBeChecked()
  await expect(page).not.toHaveURL(/ov=/)
  await expect(keyHead(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Retirer les calques' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('the overlays tab is keyboard operable like the other tabs', async ({ page }) => {
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  const colour = page.getByRole('tab', { name: 'Couleur' })
  await colour.focus()
  await page.keyboard.press('ArrowRight')
  await expect(overlaysTab(page)).toBeFocused()
  await expect(overlaysTab(page)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /^Filtres/ })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(overlaysTab(page)).toHaveAttribute('tabindex', '0')
  await expect(colour).toHaveAttribute('tabindex', '-1')
})

test('an old link to the seismic colour opens price with the seismic lines on', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/#z=6&lat=46.6&lng=2.4&th=seismic&l=fr')
  await mapReady(page)
  await expect(page.getByRole('region', { name: 'Prix médian, €/m²' })).toBeAttached()
  await expect.poll(() => overlaysInLink(page)).toContain('seismic')
  await expect(page).not.toHaveURL(/th=seismic/)
  await openLayersOnPhone(page)
  await overlaysTab(page).click()
  await expect(seismic(page)).toBeChecked()
  expect(errors).toEqual([])
})

test('on a phone the overlay key and the layers sheet are never open together', async ({ page }) => {
  test.skip(!isPhone(page), 'phone layout only')
  await page.goto('/#z=6&lat=46.6&lng=2.4&ov=seismic&l=fr')
  await mapReady(page)
  const layersButton = page.getByRole('button', { name: 'Couches', exact: true })
  await keyHead(page).click()
  await expect(page.locator('.ov-key')).toHaveAttribute('open', '')
  await layersButton.click()
  await expect(page.locator('.layers')).toBeVisible()
  await expect(page.locator('.ov-key')).not.toHaveAttribute('open', '')
  await keyHead(page).click()
  await expect(page.locator('.ov-key')).toHaveAttribute('open', '')
  await expect(page.locator('.layers')).toBeHidden()
  await expect(layersButton).toHaveAttribute('aria-expanded', 'false')
})

test('a risk is offered exactly when the archive holds lines for it, whatever the other risks have', async ({ page }) => {
  const manifest = await overlayManifest()
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await overlaysTab(page).click()
  await openGroup(page, 'Risques naturels')
  for (const [id, name] of Object.entries(RISK_NAMES)) {
    await expect(page.getByRole('checkbox', { name, exact: true }), id).toHaveCount(hasRiskLines(manifest, id) ? 1 : 0)
  }
})

test('a risk drawn as lines is keyed by the class each line rises to, and what a line means is said once', async ({ page }) => {
  const manifest = await overlayManifest()
  test.skip(!hasRiskLines(manifest, 'flood'), 'the overlays archive holds no flood lines yet')
  const errors = collectErrors(page)
  await page.goto('/#z=8&lat=45.8&lng=4.6&ov=flood&l=fr')
  await mapReady(page)
  if (isPhone(page)) await keyHead(page).click()
  const legend = page.getByRole('region', { name: 'Prix médian, €/m²' })
  await expect(legend.getByText("Étape 1 : atlas des zones inondables ou DDRM seulement")).toBeVisible()
  await expect(legend.getByText('Étape 3 : plan de prévention approuvé')).toBeVisible()
  await expect(legend.getByText(/Une ligne marque le passage de la valeur/)).toBeVisible()
  await expect(legend.getByText(/une commune au bord peut n'être touchée qu'en partie/)).toBeVisible()
  await expect(legend.getByText(/entourées/)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('on a phone the open overlay key keeps to 40 % of the screen and scrolls inside', async ({ page }) => {
  test.skip(!isPhone(page), 'phone layout only')
  const manifest = await overlayManifest()
  const kinds = Object.entries((manifest?.layers?.places as { kinds?: Record<string, number> } | undefined)?.kinds ?? {}).flatMap(([id, count]) => (count > 0 ? [id] : []))
  test.skip(kinds.length < 8, 'the overlays archive holds too few place kinds to fill the key')
  await page.goto(`/#z=8&lat=45.8&lng=4.6&ov=seismic,${kinds.join(',')}&l=fr`)
  await mapReady(page)
  await keyHead(page).click()
  await expect(page.locator('.ov-key')).toHaveAttribute('open', '')
  const height = page.viewportSize()?.height ?? 0
  const key = await page.locator('.ov-key').boundingBox()
  expect(key?.height ?? Infinity).toBeLessThanOrEqual(height * 0.4 + 1)
  const body = page.locator('.ov-key__body')
  expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
  // Scrolling the key does not move the map or the page: the last row comes into view inside the body.
  await body.evaluate((element) => element.scrollTo(0, element.scrollHeight))
  await expect(page.locator('.ov-key__list > li').last()).toBeInViewport()
})
