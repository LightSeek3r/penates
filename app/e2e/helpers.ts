import { expect, type Page } from '@playwright/test'

// On phones the colour/filter panel and the legend details sit in the bottom sheet behind "Couches".
export async function openLayersOnPhone(page: Page) {
  const toggle = page.getByRole('button', { name: /^(Couches|Layers)$/ })
  if (await toggle.isVisible()) await toggle.click()
}

// The shareable URL is written by the map, so interactions wait until it is ready.
export async function mapReady(page: Page) {
  await expect(page.locator('main')).toHaveAttribute('data-map-status', 'ready', { timeout: 20_000 })
}
