import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['client-performance.spec.ts', 'client-reliability.spec.ts'],
  timeout: 30_000,
  workers: 1,
  outputDir: 'node_modules/.cache/playwright-performance',
  use: {
    baseURL: 'http://127.0.0.1:4189',
    headless: true,
    viewport: { width: 1000, height: 900 },
    permissions: ['microphone'],
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4189 --strictPort`,
    url: 'http://127.0.0.1:4189/e2e/fixtures/performance.html',
    reuseExistingServer: false,
  },
})
