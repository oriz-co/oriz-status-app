/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_STATUS_API_BASE?: string
  readonly PUBLIC_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
