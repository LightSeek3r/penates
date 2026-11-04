import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // MapLibre 6 starts its worker with { type: 'module' }, so the bundled worker must be an ES module.
  worker: { format: 'es' },
  build: { target: 'es2023', chunkSizeWarningLimit: 1100 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
