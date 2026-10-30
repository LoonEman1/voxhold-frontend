export function recordingMIME() {
  if (!globalThis.MediaRecorder) return null
  // VP8 is widely hardware accelerated; don't force a costly software VP9 encoder.
  return ['video/webm;codecs=vp8,opus', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm', 'video/mp4'].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null
}
