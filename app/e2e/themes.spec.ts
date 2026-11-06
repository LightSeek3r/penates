import { expect, test } from '@playwright/test'
import { communeTileFields, mapReady, openGroup, openLayersOnPhone } from './helpers'

const LYON_3E = '#z=11&lat=45.76&lng=4.86&t=all&c=69383&l=fr'

test('colours the map by seismic zone and swaps the legend', async ({ page }) => {
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await openGroup(page, 'Risques')
  await page.getByRole('radio', { name: 'Zone sismique' }).check()
  await expect(page.getByRole('region', { name: 'Zone sismique' })).toBeVisible()
  // Phones show the zone numbers only; the full wording is still in the page for screen readers.
  await expect(page.getByText('Zone 3 : modérée')).toBeAttached()
  await expect(page).toHaveURL(/th=seismic/)
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
  await page.goto('/#z=6&lat=46.6&lng=2.4&th=hospital&f=gp-5000.seismic-3&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(page.getByRole('region', { name: /Distance au plus proche : hôpital/ })).toBeVisible()
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

test('a risk theme and its filter open from a link, and the filter counter follows the link', async ({ page }) => {
  await page.goto('/#z=6&lat=46.6&lng=2.4&th=flood&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(page.getByRole('region', { name: 'Exposition aux inondations' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Inondation' })).toBeChecked()
  const filtersTab = page.getByRole('tab', { name: /Filtres/ })
  await expect(filtersTab.locator('.badge')).toHaveCount(0)

  await page.goto('about:blank')
  await page.goto('/#z=6&lat=46.6&lng=2.4&th=flood&f=flood-1.altitude-200_800&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(filtersTab).toContainText('2')
  await filtersTab.click()
  // The first group holding an active filter opens by itself.
  await expect(page.getByRole('slider', { name: 'Inondation : classe maximale' })).toHaveValue('1')
  await expect(page.getByText('classe 1 au plus')).toBeVisible()
  await page.getByRole('slider', { name: 'Inondation : classe maximale' }).fill('3')
  await expect(filtersTab).toContainText('1')
  await expect(page).toHaveURL(/f=altitude-200_800(&|$)/)
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

