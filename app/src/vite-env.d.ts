/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_BASE?: string
}

/** package.json's version, injected at build time (vite.config.ts). */
declare const __APP_VERSION__: string
