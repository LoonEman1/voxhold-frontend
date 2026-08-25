import { describe, expect, it } from 'vitest'
import { classifyHDRFrame, detectHDROutputCapabilities, streamWatchCapabilities, type HDRCapabilities } from './hdrCapabilities'

describe('HDR capability detection', () => {
  it('keeps output dynamic range and gamut as independent facts', () => {
    const matches = new Set(['(video-dynamic-range: high)', '(video-color-gamut: rec2020)'])
    expect(detectHDROutputCapabilities((query) => ({ matches: matches.has(query) }))).toEqual({
      dynamicRange: 'high',
      gamut: 'rec2020',
    })
    expect(detectHDROutputCapabilities(() => ({ matches: false }))).toEqual({
      dynamicRange: 'standard',
      gamut: 'srgb',
    })
  })

  it('accepts only 10-bit BT.2020 PQ or HLG frames', () => {
    expect(classifyHDRFrame({ format: 'I010', primaries: 'bt2020', transfer: 'smpte-st-2084', matrix: 'bt2020-ncl' }))
      .toEqual({ dynamicRange: 'hdr10', bitDepth: 10, valid: true })
    expect(classifyHDRFrame({ format: 'P010', primaries: 'bt2020', transfer: 'arib-std-b67', matrix: 'bt2020-ncl' }))
      .toEqual({ dynamicRange: 'hlg', bitDepth: 10, valid: true })
    expect(classifyHDRFrame({ format: 'I420', primaries: 'bt2020', transfer: 'smpte-st-2084', matrix: 'bt2020-ncl' }).valid)
      .toBe(false)
    expect(classifyHDRFrame({ format: 'I010', primaries: 'bt709', transfer: 'smpte-st-2084', matrix: 'bt709' }).valid)
      .toBe(false)
  })

  it('advertises HDR profiles only after the full viewer gate', () => {
    const capabilities: HDRCapabilities = {
      output: { dynamicRange: 'high', gamut: 'rec2020' },
      processing: { trackProcessor: true, trackGenerator: true, webGPU: true },
      codecs: [],
      codecProfiles: [{ codec: 'vp9', profile: '2' }],
      canPublishHDR: true,
      canViewHDR: true,
      reason: '',
    }
    expect(streamWatchCapabilities(capabilities)).toEqual({
      supported_dynamic_ranges: ['sdr', 'hdr10', 'hlg'],
      codec_profiles: [{ codec: 'vp9', profile: '2' }],
    })
    expect(streamWatchCapabilities(capabilities, true)).toEqual({
      supported_dynamic_ranges: ['sdr'],
      codec_profiles: [],
    })
  })
})
