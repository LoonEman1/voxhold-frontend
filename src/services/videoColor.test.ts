import { describe, expect, it } from 'vitest'
import { isSDRFrame } from './videoColor'

describe('zero-copy SDR eligibility', () => {
  it('accepts explicit 8-bit BT.709 but keeps HDR, wide gamut and unknown frames on conversion', () => {
    const frame = { format: 'I420', colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' } } as unknown as VideoFrame
    expect(isSDRFrame(frame)).toBe(true)
    expect(isSDRFrame({ ...frame, format: 'I010' } as unknown as VideoFrame)).toBe(false)
    expect(isSDRFrame({ ...frame, colorSpace: { primaries: 'bt2020', transfer: 'smpte-st-2084', matrix: 'bt2020-ncl' } } as unknown as VideoFrame)).toBe(false)
    expect(isSDRFrame({ ...frame, colorSpace: { primaries: 'smpte432', transfer: 'iec61966-2-1', matrix: 'rgb' } } as unknown as VideoFrame)).toBe(false)
    expect(isSDRFrame({ ...frame, colorSpace: {} } as VideoFrame)).toBe(false)
  })
})
