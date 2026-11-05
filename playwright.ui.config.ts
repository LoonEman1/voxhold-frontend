import { defineConfig } from '@playwright/test'

const baseURL = `http://127.0.0.1:${process.env.VOXHOLD_UI_PORT || '4190'}`

export default defineConfig({
  testDir: './e2e', testMatch: ['ui-fixes.spec.ts', 'personal-space.spec.ts', 'links-drafts.spec.ts', 'workspace-layout.spec.ts', 'modal-layout.spec.ts', 'composer-actions.spec.ts', 'message-layout.spec.ts'], timeout: 30_000, workers: 1,
  outputDir: 'node_modules/.cache/playwright-ui',
  use: { baseURL, headless: true, channel: process.env.VOXHOLD_E2E_BROWSER_CHANNEL, viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${new URL(baseURL).port} --strictPort`, url: `${baseURL}/e2e/fixtures/ui-fixes.html`, reuseExistingServer: false },
})
