import type { FeatureSource } from '../domain/community'

export const featuresChanged = () => window.dispatchEvent(new Event('voxhold:community'))
export const openForward = (source: FeatureSource) => window.dispatchEvent(new CustomEvent('voxhold:forward', { detail: source }))
export const saveFavorite = (source: FeatureSource) => window.dispatchEvent(new CustomEvent('voxhold:favorite', { detail: source }))
