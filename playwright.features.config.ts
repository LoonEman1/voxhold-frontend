import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: 'community-features.spec.ts', timeout: 120_000, workers: 1,
  outputDir: 'node_modules/.cache/playwright-features',
  webServer: { command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4193 --strictPort`, env: { VITE_DEV_API_PROXY: process.env.VOXHOLD_COMMUNITY_API ?? 'http://127.0.0.1:18083' }, url: 'http://127.0.0.1:4193', reuseExistingServer: true },
  use: { baseURL: 'http://127.0.0.1:4193', actionTimeout: 15_000, headless: true, viewport: { width: 1440, height: 960 }, trace: 'retain-on-failure', launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--auto-select-desktop-capture-source=Entire screen'] } },
})
