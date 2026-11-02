import { describe, expect, it } from 'vitest'
import { MAX_COUNTER, ReplayWindow, frameIV, headerLength, readHeader, writeHeader } from './frame'
import { FrameDecryptor, FrameEncryptor, deriveFrameKey } from './frameCipher'

const randomKey = () => crypto.getRandomValues(new Uint8Array(32))
const opus = (size: number) => { const frame = crypto.getRandomValues(new Uint8Array(size)); frame[0] = 0x78; return frame }

describe('frame header', () => {
  it('round-trips counters with the minimal length', () => {
    const cases: Array<[number, number]> = [[0, 1], [7, 1], [8, 2], [255, 2], [256, 3], [65535, 3], [65536, 4]]
    for (const keyId of [0, 7]) {
      for (const [counter, length] of cases) {
        const buffer = new Uint8Array(12)
        expect(writeHeader(buffer, 2, keyId, counter)).toBe(length)
        expect(headerLength(counter)).toBe(length)
        expect(readHeader(buffer, 2)).toEqual({ keyId, counter, length })
      }
    }
  })

  it('rejects extended key ids, non-minimal and oversized counters', () => {
    expect(readHeader(Uint8Array.of(0x80), 0)).toBeNull()
    expect(readHeader(Uint8Array.of(0x08, 0x05), 0)).toBeNull()
    expect(readHeader(Uint8Array.of(0x0b, 0x01, 0x00, 0x00, 0x00), 0)).toBeNull()
    expect(readHeader(Uint8Array.of(0x09, 0x01), 0)).toBeNull()
    expect(() => writeHeader(new Uint8Array(8), 0, 8, 0)).toThrow()
    expect(() => writeHeader(new Uint8Array(8), 0, 0, MAX_COUNTER)).toThrow()
  })

  it('derives a distinct IV for every counter', () => {
    const salt = crypto.getRandomValues(new Uint8Array(12))
    const ivs = new Set<string>()
    for (let counter = 0; counter < 10_000; counter++) ivs.add(Array.from(frameIV(salt, counter)).join(','))
    expect(ivs.size).toBe(10_000)
    expect(Array.from(frameIV(salt, 0))).toEqual(Array.from(salt))
  })

  it('keeps the average overhead of a 10-minute key within 19 bytes', () => {
    let total = 0
    for (let counter = 0; counter < 30_000; counter++) total += headerLength(counter) + 16
    expect(total / 30_000).toBeLessThanOrEqual(19)
  })
})

describe('replay window', () => {
  it('accepts each counter once and forgets nothing inside 128 values', () => {
    const window = new ReplayWindow()
    for (const counter of [5, 3, 200, 199]) { expect(window.check(counter)).toBe(true); window.accept(counter) }
    expect(window.check(200)).toBe(false)
    expect(window.check(199)).toBe(false)
    expect(window.check(5)).toBe(false) // older than the window
    expect(window.check(100)).toBe(true)
  })
})

describe('frame cipher', () => {
  it('round-trips frames and keeps the TOC byte in clear', async () => {
    const raw = randomKey()
    const encryptor = new FrameEncryptor()
    encryptor.setKey(await deriveFrameKey(3, raw))
    const decryptor = new FrameDecryptor()
    decryptor.setKey('7:dev', await deriveFrameKey(3, raw))
    const frame = opus(120)
    const sealed = await encryptor.encrypt(frame)
    expect(sealed).not.toBeNull()
    expect(sealed![0]).toBe(0x78)
    expect(sealed!.length).toBe(frame.length + 1 + 16)
    expect(Array.from(sealed!.subarray(2, 21))).not.toEqual(Array.from(frame.subarray(1, 20)))
    const plain = await decryptor.decrypt('7:dev', sealed!)
    expect(plain).toBeInstanceOf(Uint8Array)
    expect(Array.from(plain as Uint8Array)).toEqual(Array.from(frame))
  })

  it('rejects tampering, unknown keys, other senders and replays', async () => {
    const raw = randomKey()
    const encryptor = new FrameEncryptor()
    encryptor.setKey(await deriveFrameKey(1, raw))
    const decryptor = new FrameDecryptor()
    decryptor.setKey('a', await deriveFrameKey(1, raw))
    const sealed = (await encryptor.encrypt(opus(80)))!
    for (const index of [0, 1, 5, sealed.length - 1]) {
      const changed = sealed.slice()
      changed[index] = (changed[index] as number) ^ 0x01
      expect(await decryptor.decrypt('a', changed)).not.toBeInstanceOf(Uint8Array)
    }
    expect(await decryptor.decrypt('b', sealed)).toBe('unknown_key')
    expect(await decryptor.decrypt('a', sealed)).toBeInstanceOf(Uint8Array)
    expect(await decryptor.decrypt('a', sealed)).toBe('replay')
    const other = new FrameEncryptor()
    other.setKey(await deriveFrameKey(2, raw))
    expect(await decryptor.decrypt('a', (await other.encrypt(opus(40)))!)).toBe('unknown_key')
  })

  it('never reuses a counter and drops frames instead of sending them in clear', async () => {
    const encryptor = new FrameEncryptor()
    expect(await encryptor.encrypt(opus(30))).toBeNull()
    encryptor.setKey(await deriveFrameKey(0, randomKey()))
    const counters = new Set<number>()
    for (let index = 0; index < 300; index++) counters.add(readHeader((await encryptor.encrypt(opus(30)))!, 1)!.counter)
    expect(counters.size).toBe(300)
    ;(encryptor as unknown as { counter: number }).counter = MAX_COUNTER
    expect(encryptor.exhausted).toBe(true)
    expect(await encryptor.encrypt(opus(30))).toBeNull()
  })
})
