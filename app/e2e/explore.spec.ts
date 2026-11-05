import { expect, test } from '@playwright/test'
import { mapReady, openLayersOnPhone } from './helpers'

// DVF reports Lyon by arrondissement; 69383 (Lyon 3e) is inside the department-69 dev slice.
const LYON_3E = '#z=11&lat=45.76&lng=4.86&t=all&c=69383&l=fr'

test('opens on the national price map with legend and reliability key', async ({ page }) => {
  await page.goto('/#l=fr')
  await expect(page.getByRole('region', { name: /Carte des prix/ })).toBeVisible()
  await openLayersOnPhone(page)
  await expect(page.getByRole('region', { name: 'Prix médian, €/m²' })).toBeVisible()
  await expect(page.getByText('Moins de 10 ventes : indicatif')).toBeVisible()
  await expect(page.getByText('Hors base DVF')).toBeVisible()
})

test('switches language through the English page URL', async ({ page }) => {
  await page.goto('/')
  await mapReady(page)
  await page.getByRole('link', { name: 'English' }).click()
  await expect(page).toHaveURL(/\/en\//)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('region', { name: 'Median price, €/m²' })).toBeVisible()
})

test('restores a selected commune from a shared link', async ({ page }) => {
  await page.goto(`/${LYON_3E}`)
  await expect(page.getByRole('heading', { name: /Lyon/ })).toBeVisible({ timeout: 20_000 })
  const details = page.getByRole('region', { name: 'Fiche du lieu' })
  await expect(details.getByText('€/m²')).toBeVisible()
  await expect(details.getByText(/Ventes retenues/)).toBeVisible()
})

test('changing the property type updates the shared link', async ({ page }) => {
  await page.goto(`/${LYON_3E}`)
  await mapReady(page)
  await openLayersOnPhone(page)
  await page.getByRole('radio', { name: 'Appartements' }).check()
  await expect(page).toHaveURL(/t=app/)
})

test('sources dialog opens, is labelled and closes with Escape', async ({ page }) => {
  await page.goto('/#l=fr')
  await page.getByRole('button', { name: 'Sources et limites' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sources et limites' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Alsace|57, 67, 68/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('search flies to a city and opens its details', async ({ page }) => {
  await page.goto('/#l=fr')
  const search = page.getByRole('combobox', { name: 'Rechercher une commune' })
  await search.fill('Lyon')
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 })
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: /Lyon/ })).toBeVisible({ timeout: 25_000 })
})
