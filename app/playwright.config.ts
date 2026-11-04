import { defineConfig, devices } from '@playwright/test'

const DATA_PORT = 8788
const APP_PORT = 5173

// E2E_BASE_URL points the suite at a deployed site; no local servers are started then.
const remote = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: remote ?? `http://localhost:${APP_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: remote
    ? undefined
    : [
    {
      command: `node scripts/serve-data.mjs ${process.env.DATA_DIR ?? '../data/build/slice'} ${DATA_PORT}`,
      url: `http://localhost:${DATA_PORT}/manifest.json`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm exec vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      env: { VITE_DATA_BASE: `http://localhost:${DATA_PORT}` },
      reuseExistingServer: !process.env.CI,
    },
  ],
})
