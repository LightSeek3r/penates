import { expect, test, type Page } from '@playwright/test'
import { mapReady, openGroup, openLayersOnPhone } from './helpers'

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

const picker = (page: Page) => page.getByRole('combobox', { name: 'Ajouter un second indicateur' })

test('a second indicator crossed with price colours the map in nine tiers, then shows as discs, then goes away', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/#l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)

  await picker(page).selectOption('hospital')
  await expect(page).toHaveURL(/th2=hospital&mix=cross/)
  await expect(page.getByRole('radio', { name: 'Couleurs croisées' })).toBeChecked()
  const crossKey = page.getByRole('region', { name: 'Prix médian au m² et Hôpital' })
  await expect(crossKey).toBeAttached()
  const grid = crossKey.getByRole('table', { name: /les lignes donnent Hôpital, les colonnes Prix médian au m²/ })
  await expect(grid.getByRole('rowheader')).toHaveCount(3)
  await expect(grid.getByRole('columnheader')).toHaveCount(3)
  await expect(grid.getByRole('rowheader').first()).toContainText('10')
  await expect(grid.getByRole('cell')).toHaveCount(10)
  await expect(crossKey.getByText('Pas de donnée pour l\'un des deux')).toBeAttached()

  await page.getByRole('radio', { name: 'Disques' }).check()
  await expect(page).toHaveURL(/th2=hospital&mix=marks/)
  const marksKey = page.getByRole('region', { name: 'Prix médian, €/m²' })
  await expect(marksKey.getByRole('heading', { name: 'Distance au plus proche : hôpital' })).toBeAttached()
  await expect(marksKey.getByText('Pas de disque : pas de donnée')).toBeAttached()
  await expect(marksKey.getByText(/disques sont éclaircis/)).toBeAttached()
  await expect(grid).toHaveCount(0)

  await page.getByRole('button', { name: 'Retirer le second indicateur' }).click()
  await expect(page).not.toHaveURL(/th2=|mix=/)
  await expect(picker(page)).toHaveValue('')
  await expect(marksKey.getByText('Pas de disque : pas de donnée')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a shared link restores the second indicator, and colouring by it swaps the two', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/#z=9&lat=45.76&lng=4.85&th=price&th2=hospital&mix=marks&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(picker(page)).toHaveValue('hospital')
  await expect(page.getByRole('radio', { name: 'Disques' })).toBeChecked()

  await openGroup(page, "Proximité (à vol d'oiseau)")
  await page.getByRole('radio', { name: 'Hôpital' }).check()
  await expect(page).toHaveURL(/th=hospital&th2=price&mix=marks/)
  await expect(picker(page)).toHaveValue('price')
  // The theme is never offered as its own second indicator.
  await expect(picker(page).locator('option[value="hospital"]')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a junk or opt-in second indicator in a link is ignored', async ({ page }) => {
  await page.goto('/#th2=nope&mix=blend&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(picker(page)).toHaveValue('')
  await expect(page).not.toHaveURL(/th2=|mix=/)

  await page.goto('about:blank')
  await page.goto('/#th2=violence&mix=cross&l=fr')
  await mapReady(page)
  await openLayersOnPhone(page)
  await expect(picker(page)).toHaveValue('')
  await expect(picker(page).locator('option[value="violence"]')).toHaveCount(0)
})
