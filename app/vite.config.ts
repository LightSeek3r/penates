import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA, type ManifestOptions } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'
import { securityHeaders } from './vite/headers.ts'
import { webManifest } from './vite/manifest.ts'
import { englishManifestPlugin, seoPlugin } from './vite/seo.ts'

const dataBase = process.env.VITE_DATA_BASE
const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    seoPlugin(dataBase),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      manifest: webManifest('fr') as unknown as Partial<ManifestOptions>,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,ico}', 'assets/*.json', 'pwa-*.png', 'maskable-icon-*.png', 'apple-touch-icon-*.png'],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
      devOptions: { enabled: false },
    }),
    englishManifestPlugin(),
  ],
  // MapLibre 6 starts its worker with { type: 'module' }, so the bundled worker must be an ES module.
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 1100,
    rollupOptions: { input: { main: resolve(here, 'index.html'), en: resolve(here, 'en/index.html') } },
  },
  // Same security headers as the deployed `_headers` file, so the production build is tested under its real CSP.
  preview: { headers: securityHeaders(dataBase) },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'vite/**/*.test.ts'] },
})
