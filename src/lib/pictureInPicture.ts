export function pictureInPictureAvailable() {
  return typeof document !== 'undefined' && document.pictureInPictureEnabled === true
}

/** Floats the stream above other windows so it stays visible while working. */
export async function togglePictureInPicture(video: HTMLVideoElement | null) {
  if (!video || !pictureInPictureAvailable()) return
  try {
    if (document.pictureInPictureElement === video) await document.exitPictureInPicture()
    else await video.requestPictureInPicture()
  } catch {
    // The browser may refuse (no frame yet, user gesture rules); nothing breaks.
  }
}
