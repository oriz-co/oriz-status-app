// @ts-check
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://status.oriz.in',
  base: process.env.PUBLIC_BASE_PATH ?? '/',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
})
