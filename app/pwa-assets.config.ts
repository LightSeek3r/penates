import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const background = '#0B1B3A'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { sizes: [512], padding: 0.12, resizeOptions: { background, fit: 'contain' } },
    apple: { sizes: [180], padding: 0.12, resizeOptions: { background, fit: 'contain' } },
  },
  images: ['public/logo.svg'],
})
