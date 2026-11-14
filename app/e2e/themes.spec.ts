import { expect, test } from '@playwright/test'
import { communeTileFields, mapReady, openGroup, openLayersOnPhone } from './helpers'

const LYON_3E = '#z=11&lat=45.76&lng=4.86&t=all&c=69383&l=fr'

test('colours the map by altitude and swaps the legend', async ({ page }) => {
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await openGroup(page, 'Altitude et relief')
  await page.getByRole('radio', { name: 'Altitude', exact: true }).check()
  await expect(page.getByRole('region', { name: 'Altitude', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/th=altitude/)
})

test('risks and distances are no longer offered as colours, only as filters', async ({ page }) => {
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  for (const name of ['Zone sismique', 'Inondation', 'Hôpital', 'Boulangerie']) await expect(page.getByRole('radio', { name, exact: true })).toHaveCount(0)
  await expect(page.locator('option[value="seismic"], option[value="hospital"]')).toHaveCount(0)
  await page.getByRole('tab', { name: /Filtres/ }).click()
  await openGroup(page, 'Risques')
  await expect(page.getByRole('slider', { name: 'Zone sismique maximale' })).toBeVisible()
})

test('a filter is counted, shared in the link and can be reset', async ({ page }) => {
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await page.getByRole('tab', { name: /Filtres/ }).click()
  await openGroup(page, "Proximité (à vol d'oiseau)")
  const hospital = page.getByRole('slider', { name: 'Hôpital à moins de' })
  await hospital.fill('10000')
  await expect(page).toHaveURL(/f=hospital-10000/)
  await expect(page.getByRole('tab', { name: /Filtres/ })).toContainText('1')
  await expect(page.getByText('jusqu\'à 10 km')).toBeVisible()
  await page.getByRole('button', { name: 'Tout réinitialiser' }).click()
  await expect(page).not.toHaveURL(/f=/)
})

test('restores theme and filters from a shared link', async ({ page }) => {
  await page.goto('/#z=6&lat=46.6&lng=2.4&th=altitude&f=gp-5000.seismic-3&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(page.getByRole('region', { name: 'Altitude', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Filtres/ })).toContainText('2')
})

test('details list the seismic zone and distances of a commune', async ({ page }) => {
  await page.goto(`/${LYON_3E}`)
  await mapReady(page)
  const details = page.getByRole('region', { name: 'Fiche du lieu' })
  await expect(details.getByText(/Zone sismique : \d/)).toBeVisible({ timeout: 20_000 })
  await expect(details.getByText(/Hôpital : [\d,]+ km/)).toBeVisible()
  await expect(details.getByText(/vol d'oiseau/).first()).toBeVisible()
})

// Filters the tiles do not carry are not offered, so the test uses the flood stages when the data has them
// and falls back to the seismic zone (present since the first release) otherwise.
const FLOOD = { id: 'flood', slider: 'Inondation : étape maximale', value: 1, readout: 'étape 1 au plus', off: 3 }
const SEISMIC = { id: 'seismic', slider: 'Zone sismique maximale', value: 2, readout: 'zone 2 au plus', off: 5 }

test('a risk filter opens from a link, and the filter counter follows the link', async ({ page }) => {
  const fields = await communeTileFields()
  const risk = fields?.has('fl') ? FLOOD : SEISMIC
  await page.goto('/#z=6&lat=46.6&lng=2.4&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  const filtersTab = page.getByRole('tab', { name: /Filtres/ })
  await expect(filtersTab.locator('.badge')).toHaveCount(0)

  await page.goto('about:blank')
  await page.goto(`/#z=6&lat=46.6&lng=2.4&f=${risk.id}-${risk.value}.hospital-10000&l=fr`)
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(filtersTab).toContainText('2')
  await filtersTab.click()
  // The first group holding an active filter opens by itself.
  await expect(page.getByRole('slider', { name: risk.slider })).toHaveValue(String(risk.value))
  await expect(page.getByText(risk.readout)).toBeVisible()
  await page.getByRole('slider', { name: risk.slider }).fill(String(risk.off))
  await expect(filtersTab).toContainText('1')
  await expect(page).toHaveURL(/f=hospital-10000(&|$)/)
})

test("details list a commune's risk indicators when the tiles carry them", async ({ page }) => {
  const fields = await communeTileFields()
  test.skip(!fields?.has('fl'), 'the communes tiles have no flood class (fl) yet')
  await page.goto(`/${LYON_3E}`)
  await mapReady(page)
  const details = page.getByRole('region', { name: 'Fiche du lieu' })
  await expect(details.getByText(/Inondation : \d \(/)).toBeVisible({ timeout: 20_000 })
  await expect(details.getByText(/ERRIAL/)).toBeVisible()
})

test('a shared link to a theme the tiles do not carry falls back to price', async ({ page }) => {
  const fields = await communeTileFields()
  test.skip(fields === null || fields.has('h50'), 'needs local tiles without the 2050 heat property (h50)')
  await page.goto('/#z=6&lat=46.6&lng=2.4&th=heat2050&f=heat2050-10&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(page.getByRole('region', { name: 'Prix médian, €/m²' })).toBeVisible()
  await expect(page).not.toHaveURL(/th=heat2050|f=heat2050/)
  await expect(page.getByRole('radio', { name: 'Jours de chaleur vers 2050' })).toHaveCount(0)
})

