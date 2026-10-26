export interface AvatarCrop { x: number; y: number; size: number }
export interface ImageDimensions { width: number; height: number }
export interface CropPosition { x: number; y: number }

export const clamp = (value: number, min = -1, max = 1) => Math.min(max, Math.max(min, value))

// Pixel coordinates match the browser's EXIF-oriented preview and the API.
export function avatarCrop(image: ImageDimensions, zoom: number, position: CropPosition): AvatarCrop {
  const size = Math.max(1, Math.floor(Math.min(image.width, image.height) / clamp(zoom, 1, 4)))
  return {
    x: Math.round((image.width - size) * (clamp(position.x) + 1) / 2),
    y: Math.round((image.height - size) * (clamp(position.y) + 1) / 2),
    size,
  }
}
