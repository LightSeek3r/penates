import { defineConfig, devices } from '@playwright/test'

// Overridable when another process already holds a default port (both servers are reused when found running).
const DATA_PORT = Number(process.env.DATA_PORT ?? 8788)
const APP_PORT = Number(process.env.APP_PORT ?? 4181)

// E2E_BASE_URL points the suite at a deployed site; no local servers are started then.
const remote = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // Each test loads a WebGL map (some load it twice); under a full parallel run on a laptop that can pass 30 s.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  reporter: [['list']],
  use: { baseURL: remote ?? `http://localhost:${APP_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // Locally the suite tests the production build behind the Pages runtime (`wrangler pages dev`): the real `_headers`
  // (CSP), the service worker, and the Functions with an emulated D1 database. ADMIN_DEV_BYPASS exists only here.
  webServer: remote
    ? undefined
    : [
        {
          command: `node scripts/serve-data.mjs ${process.env.DATA_DIR ?? '../data/build/slice-p2'} ${DATA_PORT}`,
          url: `http://localhost:${DATA_PORT}/manifest.json`,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `pnpm build && pnpm exec wrangler pages dev dist --port ${APP_PORT} --d1=DB --binding ADMIN_DEV_BYPASS=1 --compatibility-date=2026-01-01`,
          url: `http://localhost:${APP_PORT}`,
          env: { VITE_DATA_BASE: `http://localhost:${DATA_PORT}`, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true', CI: 'true', WRANGLER_SEND_METRICS: 'false' },
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ],
})
