import { defineConfig } from '@playwright/test'

const environment = (globalThis as typeof globalThis & {
  process: { env: Record<string, string | undefined> }
}).process.env

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: 'node_modules/.cache/playwright-results',
  reporter: [['line']],
  use: {
    baseURL: environment.VOXHOLD_E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    headless: true,
    permissions: ['microphone'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
})
