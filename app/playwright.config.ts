import { defineConfig, devices } from '@playwright/test'

// Overridable when another process already holds a default port (both servers are reused when found running).
const DATA_PORT = Number(process.env.DATA_PORT ?? 8788)
const APP_PORT = Number(process.env.APP_PORT ?? 4181)

// E2E_BASE_URL points the suite at a deployed site; no local servers are started then.
const remote = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 1,
  reporter: [['list']],
  use: { baseURL: remote ?? `http://localhost:${APP_PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // Locally the suite tests the production build (real CSP and service worker), served by `vite preview`.
  webServer: remote
    ? undefined
    : [
        {
          command: `node scripts/serve-data.mjs ${process.env.DATA_DIR ?? '../data/build/slice-p2'} ${DATA_PORT}`,
          url: `http://localhost:${DATA_PORT}/manifest.json`,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `pnpm build && pnpm exec vite preview --port ${APP_PORT} --strictPort`,
          url: `http://localhost:${APP_PORT}`,
          env: { VITE_DATA_BASE: `http://localhost:${DATA_PORT}`, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
})
