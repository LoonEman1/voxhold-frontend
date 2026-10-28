import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: 'community-fullstack.spec.ts', timeout: 60_000, workers: 1,
  outputDir: 'node_modules/.cache/playwright-community',
  use: { baseURL: 'http://127.0.0.1:4193', headless: true, viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure' },
  webServer: { command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4193 --strictPort`, env: { VITE_DEV_API_PROXY: process.env.VOXHOLD_COMMUNITY_API ?? 'http://127.0.0.1:18083' }, url: 'http://127.0.0.1:4193', reuseExistingServer: false },
})
