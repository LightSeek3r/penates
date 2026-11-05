import { expect, test } from '@playwright/test'
import { mapReady } from './helpers'

// These need the local Pages runtime (Functions + emulated D1 + the development bypass); they do not run against the live site.
test.skip(Boolean(process.env.E2E_BASE_URL), 'admin tests use the local runtime')

const send = (request: import('@playwright/test').APIRequestContext, events: { name: string; key: string }[]) =>
  request.post('/api/event', { data: { events }, headers: { 'content-type': 'application/json' } })

test.describe('anonymous counters and the admin dashboard', () => {
  test('events are counted per day and shown on the dashboard', async ({ page, request }) => {
    const response = await send(request, [
      { name: 'pageview', key: 'total' },
      { name: 'theme', key: 'hospital' },
      { name: 'theme', key: 'hospital' },
      { name: 'filter', key: 'gp' },
      { name: 'source', key: 'example.org' },
    ])
    expect(response.status()).toBe(204)

    await page.goto('/admin/')
    await expect(page.getByRole('heading', { name: 'Statistiques' })).toBeVisible()
    await expect(page.getByText('Pages vues', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('list').filter({ hasText: 'hospital' }).first()).toBeVisible()
    await expect(page.getByText('example.org')).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)

    await page.getByRole('button', { name: '90 jours' }).click()
    await expect(page.getByRole('button', { name: '90 jours' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(/sur 90 jours/)).toBeVisible()
  })

  test('free text and unknown values are dropped, never stored', async ({ request }) => {
    await send(request, [
      { name: 'search', key: 'Lyon 3e arrondissement' },
      { name: 'theme', key: 'a person name' },
      { name: 'who', key: 'knows' },
    ])
    const stats = await (await request.get('/api/admin/stats?days=7')).json()
    const keys = Object.values(stats.stats.breakdown as Record<string, { key: string }[]>).flat().map((item) => item.key)
    expect(keys).not.toContain('a person name')
    expect(JSON.stringify(stats)).not.toContain('Lyon 3e')
  })

  test('the page explains an access refusal instead of showing data', async ({ page }) => {
    await page.route('**/api/admin/stats*', (route) => route.fulfill({ status: 401, json: { error: 'unauthorized' } }))
    await page.goto('/admin/')
    await expect(page.getByRole('alert')).toContainText('Accès refusé')
  })

  test('the service worker never answers /admin with the map app', async ({ page }) => {
    await page.goto('/')
    await mapReady(page)
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await page.goto('/admin/')
    await expect(page.getByRole('heading', { name: 'Statistiques' })).toBeVisible()
  })

  test('robots.txt keeps crawlers out of the admin and the API', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text()
    expect(robots).toContain('Disallow: /admin/')
    expect(robots).toContain('Disallow: /api/')
  })
})

test.describe('visitor control over the counting', () => {
  test('the opt-out switch is remembered in this browser only', async ({ page }) => {
    await page.goto('/')
    await mapReady(page)
    await page.getByRole('button', { name: 'Sources et limites' }).click()
    const dialog = page.getByRole('dialog', { name: 'Sources et limites' })
    await expect(dialog.getByText(/sans adresse IP, sans cookie/)).toBeVisible()
    const switchBox = dialog.getByRole('checkbox', { name: 'Ne pas compter mes visites' })
    await switchBox.check()
    expect(await page.evaluate(() => localStorage.getItem('settling.optout'))).toBe('1')
    await page.reload()
    await mapReady(page)
    await page.getByRole('button', { name: 'Sources et limites' }).click()
    await expect(page.getByRole('checkbox', { name: 'Ne pas compter mes visites' })).toBeChecked()
  })

  test('nothing is sent from local or automated browsers', async ({ page }) => {
    const sent: string[] = []
    page.on('request', (request) => request.url().includes('/api/event') && sent.push(request.url()))
    await page.goto('/')
    await mapReady(page)
    await page.waitForTimeout(4000)
    expect(sent).toEqual([])
  })
})
