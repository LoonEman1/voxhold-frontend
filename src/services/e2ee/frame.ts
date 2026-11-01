/**
 * Encrypted Opus frame layout (FEAT-13), modelled on the SFrame header
 * (RFC 9605, section 4.3); only our own clients read it:
 *
 *   [TOC 1 byte, clear][header 1-9 bytes][ciphertext][AES-GCM tag 16 bytes]
 *
 * Header config byte `X K K K Y C C C`: X is always 0 (key ids fit in KKK,
 * 0-7). Y = 0 stores counters 0-7 in CCC; Y = 1 means CCC + 1 big-endian
 * counter bytes follow, using the minimal length. The TOC byte stays clear for
 * the browser jitter buffer and, with the header, is authenticated as AAD.
 */
export const TAG_BYTES = 16
export const IV_BYTES = 12
export const MAX_KEY_ID = 7
/** Counters never reach this value: senders rotate before, receivers reject it. */
export const MAX_COUNTER = 2 ** 24
export const REPLAY_WINDOW = 128

export function headerLength(counter: number): number {
  if (counter < 8) return 1
  let bytes = 0
  for (let value = counter; value > 0; value = Math.floor(value / 256)) bytes++
  return 1 + bytes
}

/** Writes the header at offset and returns its length. */
export function writeHeader(target: Uint8Array, offset: number, keyId: number, counter: number): number {
  if (!Number.isInteger(keyId) || keyId < 0 || keyId > MAX_KEY_ID) throw new RangeError('key id out of range')
  if (!Number.isInteger(counter) || counter < 0 || counter >= MAX_COUNTER) throw new RangeError('counter out of range')
  if (counter < 8) {
    target[offset] = (keyId << 4) | counter
    return 1
  }
  const length = headerLength(counter) - 1
  target[offset] = (keyId << 4) | 0x08 | (length - 1)
  for (let index = length, value = counter; index >= 1; index--, value = Math.floor(value / 256)) target[offset + index] = value % 256
  return 1 + length
}

export interface FrameHeader { keyId: number; counter: number; length: number }

/** Parses a header; null for a malformed, extended-key or out-of-range header. */
export function readHeader(data: Uint8Array, offset: number): FrameHeader | null {
  const config = data[offset]
  if (config === undefined || (config & 0x80) !== 0) return null
  const keyId = (config >> 4) & 0x07
  if ((config & 0x08) === 0) return { keyId, counter: config & 0x07, length: 1 }
  const length = (config & 0x07) + 1
  if (offset + 1 + length > data.length) return null
  let counter = 0
  for (let index = 1; index <= length; index++) counter = counter * 256 + (data[offset + index] as number)
  // A minimal encoding is mandatory: one header maps to exactly one counter.
  if (counter >= MAX_COUNTER || headerLength(counter) !== 1 + length) return null
  return { keyId, counter, length: 1 + length }
}

/** IV = salt XOR counter, the counter left-padded with zeros to 12 bytes. */
export function frameIV(salt: Uint8Array, counter: number, target = new Uint8Array(IV_BYTES)): Uint8Array<ArrayBuffer> {
  target.set(salt)
  for (let index = IV_BYTES - 1, value = counter; value > 0 && index >= 0; index--, value = Math.floor(value / 256)) {
    target[index] = (target[index] as number) ^ (value % 256)
  }
  return target as Uint8Array<ArrayBuffer>
}

/**
 * Sliding window of the last REPLAY_WINDOW counters of one key. check() is
 * pure; accept() commits a counter only after its frame authenticated, so
 * forged frames cannot poison the window.
 */
export class ReplayWindow {
  private highest = -1
  private seen = 0n

  check(counter: number): boolean {
    if (counter > this.highest) return true
    const distance = this.highest - counter
    return distance < REPLAY_WINDOW && (this.seen & (1n << BigInt(distance))) === 0n
  }

  accept(counter: number) {
    const mask = (1n << BigInt(REPLAY_WINDOW)) - 1n
    if (counter > this.highest) {
      const shift = counter - this.highest
      this.seen = shift >= REPLAY_WINDOW ? 1n : ((this.seen << BigInt(shift)) | 1n) & mask
      this.highest = counter
    } else {
      this.seen |= 1n << BigInt(this.highest - counter)
    }
  }
}
