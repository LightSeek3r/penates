import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  // MapLibre 6 resolves its module worker relative to its own file; pre-bundling breaks that path.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { target: 'es2023', chunkSizeWarningLimit: 1100 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
