import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: ['e2ee-audio.spec.ts'], timeout: 30_000, workers: 1,
  outputDir: 'node_modules/.cache/playwright-e2ee',
  use: {
    baseURL: 'http://127.0.0.1:4191', headless: true, trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      executablePath: process.env.VOXHOLD_E2E_BROWSER_EXECUTABLE,
      args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4191 --strictPort`,
    url: 'http://127.0.0.1:4191/e2e/fixtures/e2ee-audio.html', reuseExistingServer: false,
  },
})
