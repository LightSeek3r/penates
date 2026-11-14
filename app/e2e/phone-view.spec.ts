import { expect, test, type Page } from '@playwright/test'
import { mapReady } from './helpers'

// The communes tiles, which every theme but the price ones draws alone, start at this zoom.
const COMMUNES_FROM_TILE_ZOOM = 4
const SWATCH_TOLERANCE = 16
// The two painted departments of the dev slice cover about 650 CSS pixels; an unpainted map matches about 40 by chance.
const MIN_PAINTED_CSS_PIXELS = 300

const PHONES = [
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
]

const shownZoom = (page: Page) => Number(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('z'))

// Pixels of the map close to a legend colour; the fill is slightly translucent, hence the tolerance.
async function legendColouredPixels(page: Page): Promise<number> {
  const swatchElements = page.locator('.ladder__swatch')
  const swatches = await swatchElements.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor))
  // The legend strip overlaps the foot of the map and its swatches would count as painted communes.
  const map = (await page.locator('.map').boundingBox())!
  const legendTop = (await swatchElements.first().boundingBox())!.y
  const picture = await page.screenshot({ clip: { ...map, height: legendTop - map.y } })
  // The app's content security policy forbids data: URLs, so the picture is decoded on a blank page.
  const scratch = await page.context().newPage()
  const count = await scratch.evaluate(
    async ({ base64, colours, tolerance }) => {
      const wanted = colours.map((colour) => (colour.match(/\d+/g) ?? []).slice(0, 3).map(Number))
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
      let count = 0
      for (let index = 0; index < data.length; index += 4) {
        if (wanted.some(([red, green, blue]) => Math.abs(data[index] - red) <= tolerance && Math.abs(data[index + 1] - green) <= tolerance && Math.abs(data[index + 2] - blue) <= tolerance)) count += 1
      }
      return count
    },
    { base64: picture.toString('base64'), colours: swatches, tolerance: SWATCH_TOLERANCE },
  )
  await scratch.close()
  return count / (await page.evaluate(() => devicePixelRatio)) ** 2
}

for (const phone of PHONES) {
  test(`the default view on a ${phone.name} phone is zoomed enough for a communes-only theme to paint`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height })
    await page.goto('/#l=fr&th=altitude')
    await mapReady(page)
    expect(shownZoom(page)).toBeGreaterThanOrEqual(COMMUNES_FROM_TILE_ZOOM)
    await expect.poll(() => legendColouredPixels(page), { timeout: 20_000 }).toBeGreaterThan(MIN_PAINTED_CSS_PIXELS)
  })
}
