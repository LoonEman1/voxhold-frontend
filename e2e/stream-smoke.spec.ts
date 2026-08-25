import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  attachFailureArtifacts,
  expectDecodedFrames,
  installMediaProbe,
  joinVoice,
  login,
  remoteIceUfrags,
  selectedCandidateTypes,
  startServerStream,
  streamSmokeEnvironment,
  watchServerStream,
} from './support/voxhold'

async function runStreamSmoke(browser: Browser, requireTURN: boolean, pages: Page[]) {
  const environment = streamSmokeEnvironment()
  const publisherContext = await browser.newContext()
  const viewerContext = await browser.newContext()
  await installMediaProbe(publisherContext)
  await installMediaProbe(viewerContext)
  const publisher = await publisherContext.newPage()
  const viewer = await viewerContext.newPage()
  pages.push(publisher, viewer)

  await Promise.all([
    login(publisher, environment.publisher),
    login(viewer, environment.viewer),
  ])
  await Promise.all([
    joinVoice(publisher, environment.voiceChannel),
    joinVoice(viewer, environment.voiceChannel),
  ])
  await startServerStream(publisher)
  await watchServerStream(viewer)

  const beforeRestart = await remoteIceUfrags(viewer)
  await viewerContext.setOffline(true)
  await expect(viewer.locator('.voice-orbit')).not.toHaveClass(/is-connected/, { timeout: 15_000 })
  await viewerContext.setOffline(false)
  await expect(viewer.locator('.voice-orbit')).toHaveClass(/is-connected/, { timeout: 75_000 })
  await expectDecodedFrames(viewer, 6)

  await expect.poll(async () => new Set(await remoteIceUfrags(viewer)).size, {
    timeout: 75_000,
  }).toBeGreaterThan(new Set(beforeRestart).size)

  if (requireTURN) {
    await expect.poll(async () => selectedCandidateTypes(viewer), {
      timeout: 30_000,
    }).toContain('relay')
  }
}

test.describe('server stream WebRTC smoke', () => {
  const pages: Page[] = []

  test.afterEach(async ({ browser: _browser }, testInfo) => {
    await attachFailureArtifacts(testInfo, pages)
    await Promise.all(pages.map((page) => page.context().close()))
    pages.length = 0
  })

  test('two Chromium clients decode frames after an ICE generation restart', async ({ browser }) => {
    await runStreamSmoke(browser, false, pages)
  })

  test('TURN relay transports the stream', async ({ browser }) => {
    const environment = streamSmokeEnvironment()
    test.skip(!environment.runTURN, 'Set VOXHOLD_E2E_RUN_TURN=1 against a relay-only test instance')
    await runStreamSmoke(browser, true, pages)
  })
})
