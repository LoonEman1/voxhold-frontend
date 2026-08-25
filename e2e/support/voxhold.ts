import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test'

export interface StreamSmokeEnvironment {
  publisher: { username: string; password: string }
  viewer: { username: string; password: string }
  voiceChannel: string
  runTURN: boolean
}

interface BrowserProbeState {
  remoteIceUfrags: string[]
}

function environment() {
  return (globalThis as typeof globalThis & {
    process: { env: Record<string, string | undefined> }
  }).process.env
}

export function streamSmokeEnvironment(): StreamSmokeEnvironment {
  const env = environment()
  const required = {
    publisherUsername: env.VOXHOLD_E2E_PUBLISHER_USERNAME,
    publisherPassword: env.VOXHOLD_E2E_PUBLISHER_PASSWORD,
    viewerUsername: env.VOXHOLD_E2E_VIEWER_USERNAME,
    viewerPassword: env.VOXHOLD_E2E_VIEWER_PASSWORD,
    voiceChannel: env.VOXHOLD_E2E_VOICE_CHANNEL,
  }
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`Missing prepared Voxhold E2E environment values: ${missing.join(', ')}`)
  }
  return {
    publisher: {
      username: required.publisherUsername as string,
      password: required.publisherPassword as string,
    },
    viewer: {
      username: required.viewerUsername as string,
      password: required.viewerPassword as string,
    },
    voiceChannel: required.voiceChannel as string,
    runTURN: env.VOXHOLD_E2E_RUN_TURN === '1',
  }
}

export async function installMediaProbe(context: BrowserContext) {
  await context.addInitScript(() => {
    const state: BrowserProbeState = { remoteIceUfrags: [] }
    const peers: RTCPeerConnection[] = []
    Reflect.set(window, '__voxholdE2EState', state)
    Reflect.set(window, '__voxholdE2EPeers', peers)

    const NativePeerConnection = window.RTCPeerConnection
    const ObservedPeerConnection = new Proxy(NativePeerConnection, {
      construct(Target, args) {
        const peer = Reflect.construct(Target, args) as RTCPeerConnection
        peers.push(peer)
        const setRemoteDescription = peer.setRemoteDescription.bind(peer)
        peer.setRemoteDescription = async (description) => {
          const sdp = description?.sdp ?? ''
          for (const match of sdp.matchAll(/^a=ice-ufrag:(.+)$/gm)) {
            const ufrag = match[1]?.trim()
            if (ufrag && !state.remoteIceUfrags.includes(ufrag)) state.remoteIceUfrags.push(ufrag)
          }
          await setRemoteDescription(description)
        }
        return peer
      },
    })
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      value: ObservedPeerConnection,
    })

    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 1280
        canvas.height = 720
        const drawing = canvas.getContext('2d')
        if (!drawing) throw new Error('2D canvas is unavailable for the E2E screen source')
        let frame = 0
        const render = () => {
          frame += 1
          drawing.fillStyle = `hsl(${frame % 360} 80% 45%)`
          drawing.fillRect(0, 0, canvas.width, canvas.height)
          drawing.fillStyle = '#fff'
          drawing.font = '64px sans-serif'
          drawing.fillText(`Voxhold E2E ${frame}`, 80, 140)
        }
        render()
        const timer = window.setInterval(render, 33)
        const stream = canvas.captureStream(30)
        stream.getVideoTracks()[0]?.addEventListener('ended', () => window.clearInterval(timer), { once: true })
        Reflect.set(window, '__voxholdE2EScreen', { canvas, stream, timer })
        return stream
      },
    })
  })
}

export async function login(page: Page, credentials: { username: string; password: string }) {
  await page.goto('/')
  await page.locator('input[autocomplete="username"]').fill(credentials.username)
  await page.locator('input[autocomplete="current-password"]').fill(credentials.password)
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('main.workspace')).toBeVisible()
}

export async function joinVoice(page: Page, channelName: string) {
  const channel = page.locator('.channel-row__main').filter({ hasText: channelName }).first()
  await expect(channel).toBeVisible()
  await channel.click()
  await page.locator('.voice-room__intro > button.button--primary').click()
  await expect(page.locator('.voice-orbit')).toHaveClass(/is-connected/)
}

export async function startServerStream(page: Page) {
  await page.locator('.voice-controls .voice-control').nth(2).click()
  const dialog = page.locator('.modal').filter({ has: page.locator('.stream-settings-grid') })
  await expect(dialog).toBeVisible()
  await dialog.locator('select').first().selectOption('server')
  await dialog.locator('.stream-dialog-actions .button--primary').click()
  await expect(page.locator('.stream-panel video')).toBeVisible()
}

export async function watchServerStream(page: Page) {
  const watch = page.locator('.stream-panel > button.button--primary')
  await expect(watch).toBeVisible()
  await watch.click()
  await expect(page.locator('.stream-panel video')).toBeVisible()
  await expectDecodedFrames(page)
}

export async function expectDecodedFrames(page: Page, minimum = 3) {
  await expect.poll(async () => page.locator('.stream-panel video').evaluate((element) => {
    const video = element as HTMLVideoElement
    return video.getVideoPlaybackQuality().totalVideoFrames
  })).toBeGreaterThanOrEqual(minimum)
}

export async function remoteIceUfrags(page: Page) {
  return page.evaluate(() => {
    const state = Reflect.get(window, '__voxholdE2EState') as BrowserProbeState | undefined
    return state?.remoteIceUfrags ?? []
  })
}

export async function selectedCandidateTypes(page: Page) {
  return page.evaluate(async () => {
    const peers = (Reflect.get(window, '__voxholdE2EPeers') as RTCPeerConnection[] | undefined) ?? []
    const result: string[] = []
    for (const peer of peers) {
      const report = await peer.getStats()
      report.forEach((entry) => {
        if (entry.type !== 'candidate-pair' || entry.state !== 'succeeded' || !entry.nominated) return
        const remote = report.get(entry.remoteCandidateId)
        if (remote?.candidateType) result.push(remote.candidateType as string)
      })
    }
    return result
  })
}

export async function attachFailureArtifacts(testInfo: TestInfo, pages: Page[]) {
  if (testInfo.status === testInfo.expectedStatus) return
  const snapshots = await Promise.all(pages.map(async (page) => ({
    url: page.url(),
    remoteIceUfrags: await remoteIceUfrags(page).catch(() => []),
    candidateTypes: await selectedCandidateTypes(page).catch(() => []),
    videos: await page.locator('video').evaluateAll((videos) => videos.map((element) => {
      const video = element as HTMLVideoElement
      const quality = video.getVideoPlaybackQuality()
      return {
        readyState: video.readyState,
        currentTime: video.currentTime,
        totalVideoFrames: quality.totalVideoFrames,
        droppedVideoFrames: quality.droppedVideoFrames,
      }
    })).catch(() => []),
  })))
  await testInfo.attach('webrtc-stats.json', {
    body: JSON.stringify(snapshots, null, 2),
    contentType: 'application/json',
  })
}
