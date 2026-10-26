const SDR_FORMATS = new Set(['I420', 'I420A', 'I422', 'I444', 'NV12', 'RGBA', 'RGBX', 'BGRA', 'BGRX'])
/** Inspect every frame: switching the captured surface can change its range. */
export function isSDRFrame(frame: Pick<VideoFrame, 'format' | 'colorSpace'>) {
  return SDR_FORMATS.has(frame.format ?? '')
    && frame.colorSpace.primaries === 'bt709'
    && (frame.colorSpace.transfer === 'bt709' || frame.colorSpace.transfer === 'iec61966-2-1')
    && (frame.colorSpace.matrix === 'bt709' || frame.colorSpace.matrix === 'rgb')
}
