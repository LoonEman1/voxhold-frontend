/**
 * Publisher-side tuning of the REMOTE description. libwebrtc takes its send
 * parameters (start bitrate, Opus stereo and target bitrate) from the codec
 * parameters of the remote description, so the publishing browser adjusts its
 * own copy before applying it. The answer it produces is unchanged and the
 * other side never sees these values.
 */

const NON_PRIMARY_VIDEO_CODECS = new Set(['rtx', 'red', 'ulpfec', 'flexfec-03'])

/** Upper bound of the initial bandwidth estimate for screen sharing. */
const MAX_START_BITRATE_KBPS = 2500

type FmtpParameters = Array<[string, string]>

interface CodecParameters {
  get(key: string): string | undefined
  set(key: string, value: string): void
}

function parseFmtp(value: string): FmtpParameters {
  return value.split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf('=')
      return separator < 0
        ? [part, '']
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
    })
}

function formatFmtp(parameters: FmtpParameters) {
  return parameters.map(([key, value]) => value === '' ? key : `${key}=${value}`).join(';')
}

function tuneSection(
  section: string[],
  tune: (codec: string, parameters: CodecParameters) => void,
) {
  const lines = [...section]
  for (const line of section) {
    const rtpmap = /^a=rtpmap:(\d+) ([^/\s]+)/.exec(line)
    if (!rtpmap) continue
    const payloadType = rtpmap[1] ?? ''
    const fmtpPrefix = `a=fmtp:${payloadType} `
    const fmtpIndex = lines.findIndex((item) => item.startsWith(fmtpPrefix))
    const parameters = fmtpIndex >= 0 ? parseFmtp((lines[fmtpIndex] ?? '').slice(fmtpPrefix.length)) : []
    let changed = false
    tune((rtpmap[2] ?? '').toLowerCase(), {
      get: (key) => parameters.find(([name]) => name.toLowerCase() === key)?.[1],
      set: (key, value) => {
        const existing = parameters.find(([name]) => name.toLowerCase() === key)
        if (existing?.[1] === value) return
        if (existing) existing[1] = value
        else parameters.push([key, value])
        changed = true
      },
    })
    if (!changed) continue
    const fmtp = `${fmtpPrefix}${formatFmtp(parameters)}`
    if (fmtpIndex >= 0) {
      lines[fmtpIndex] = fmtp
    } else {
      const rtpmapIndex = lines.findIndex((item) => item.startsWith(`a=rtpmap:${payloadType} `))
      lines.splice(rtpmapIndex + 1, 0, fmtp)
    }
  }
  return lines
}

function tuneCodecParameters(
  sdp: string,
  kind: 'audio' | 'video',
  tune: (codec: string, parameters: CodecParameters) => void,
) {
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n'
  const result: string[] = []
  let section: string[] | null = null
  const flush = () => {
    if (section) result.push(...tuneSection(section, tune))
    section = null
  }
  for (const line of sdp.split(eol)) {
    if (line.startsWith('m=')) {
      flush()
      if (line.startsWith(`m=${kind} `)) {
        section = [line]
        continue
      }
    } else if (section) {
      section.push(line)
      continue
    }
    result.push(line)
  }
  flush()
  return result.join(eol)
}

/**
 * Chrome starts bandwidth estimation at 300 kbit/s, so screen text stays
 * blurry for several seconds after every (re)connect. A start bitrate lets the
 * first probes reach the target almost immediately.
 */
export function withVideoStartBitrate(sdp: string, kbps: number) {
  if (!Number.isFinite(kbps) || kbps <= 0) return sdp
  const value = String(Math.round(kbps))
  return tuneCodecParameters(sdp, 'video', (codec, parameters) => {
    if (NON_PRIMARY_VIDEO_CODECS.has(codec) || parameters.get('x-google-start-bitrate') !== undefined) return
    parameters.set('x-google-start-bitrate', value)
  })
}

/**
 * Without stereo=1 in the remote description Chrome encodes system audio as
 * mono at its 32 kbit/s default. The remote's own lower bitrate ceiling is
 * kept: the SFU advertises its configured maximum.
 */
export function withOpusStereo(sdp: string, maxAverageBitrateBps: number) {
  const limit = Math.round(maxAverageBitrateBps)
  return tuneCodecParameters(sdp, 'audio', (codec, parameters) => {
    if (codec !== 'opus') return
    parameters.set('stereo', '1')
    const current = Number(parameters.get('maxaveragebitrate'))
    if (limit > 0 && (!Number.isFinite(current) || current <= 0 || current > limit)) {
      parameters.set('maxaveragebitrate', String(limit))
    }
  })
}

export function streamStartBitrateKbps(targetKbps: number) {
  return Math.min(MAX_START_BITRATE_KBPS, Math.round(targetKbps * 0.4))
}

export function tunePublisherRemoteDescription(
  sdp: string,
  preferences: { videoBitrateKbps: number; audioBitrateKbps: number },
) {
  return withOpusStereo(
    withVideoStartBitrate(sdp, streamStartBitrateKbps(preferences.videoBitrateKbps)),
    preferences.audioBitrateKbps * 1000,
  )
}
