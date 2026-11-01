import type { E2EEStore } from './deviceKeys'

export interface PartyKeys { userId: number; publicKeys: string[] }

/**
 * Security code of two users (FEAT-13): SHA-256 over the sorted pairs
 * (user id, sorted base64 device keys), stretched to 60 bytes with a counter
 * prefix and shown as 12 groups of 5 digits. Both sides compute the same
 * code; a server that substitutes keys changes it.
 */
export async function safetyCode(first: PartyKeys, second: PartyKeys): Promise<string> {
  const canonical = [first, second]
    .map((party) => `${party.userId}:${[...party.publicKeys].sort().join(',')}`)
    .sort()
    .join('|')
  const input = new TextEncoder().encode(canonical)
  const blocks = await Promise.all([0, 1].map(async (counter) => {
    const prefixed = new Uint8Array(input.length + 1)
    prefixed[0] = counter
    prefixed.set(input, 1)
    return new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed))
  }))
  const bytes = new Uint8Array(64)
  bytes.set(blocks[0] as Uint8Array, 0)
  bytes.set(blocks[1] as Uint8Array, 32)
  const groups: string[] = []
  for (let group = 0; group < 12; group++) {
    let value = 0
    for (let index = 0; index < 5; index++) value = value * 256 + (bytes[group * 5 + index] as number)
    groups.push(String(value % 100_000).padStart(5, '0'))
  }
  return groups.join(' ')
}

export type KeyTrust = 'first_seen' | 'unchanged' | 'changed'

/**
 * Trust on first use: remembers the device keys of a peer and reports when
 * they differ from the last time (a new device or a substituted key).
 */
export async function rememberPeerKeys(store: E2EEStore, userId: number, keys: Record<string, string>): Promise<KeyTrust> {
  const previous = await store.getSeen(userId)
  // A device that logged out (removed key) is not a reason to warn.
  const known = previous !== undefined && Object.entries(keys).every(([device, key]) => previous.keys[device] === key)
  const sameSet = known && Object.keys(previous.keys).length === Object.keys(keys).length
  if (!sameSet) await store.putSeen({ userId, keys })
  if (!previous) return 'first_seen'
  return known ? 'unchanged' : 'changed'
}
