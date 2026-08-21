import { describe, expect, it } from 'vitest'
import { createNativeInviteURL, createWebInviteURL } from './inviteLinks'

describe('invitation links', () => {
  it('creates a web landing URL on the instance frontend', () => {
    expect(createWebInviteURL('token/with space', 'https://chat.example.com:8443/')).toBe(
      'https://chat.example.com:8443/#/invite/token%2Fwith%20space',
    )
  })

  it('creates a native fallback with the encoded instance address', () => {
    expect(createNativeInviteURL('token/with space', 'https://chat.example.com:8443/')).toBe(
      'voxhold://invite/token%2Fwith%20space?server=https%3A%2F%2Fchat.example.com%3A8443',
    )
  })
})
