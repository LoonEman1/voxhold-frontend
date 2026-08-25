import { describe, expect, it } from 'vitest'
import { classifyHDRFrame, detectHDROutputCapabilities } from './hdrCapabilities'

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
})
