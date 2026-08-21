export function createWebInviteURL(token: string, frontendURL: string): string {
  return `${frontendURL.trim().replace(/\/+$/, '')}/#/invite/${encodeURIComponent(token)}`
}
export function createNativeInviteURL(token: string, serverURL: string): string {
  return `voxhold://invite/${encodeURIComponent(token)}?server=${encodeURIComponent(serverURL.trim().replace(/\/+$/, ''))}`
}
