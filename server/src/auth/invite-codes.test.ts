import { describe, it, expect } from 'vitest'
import { canUseInviteCode } from './invite-codes'

describe('canUseInviteCode', () => {
  it('allows an unlimited-use code with no revocation', () => {
    expect(canUseInviteCode({ maxUses: null, useCount: 999, revokedAt: null })).toBe(true)
  })

  it('allows a limited-use code below its cap', () => {
    expect(canUseInviteCode({ maxUses: 3, useCount: 2, revokedAt: null })).toBe(true)
  })

  it('rejects a limited-use code at its cap', () => {
    expect(canUseInviteCode({ maxUses: 3, useCount: 3, revokedAt: null })).toBe(false)
  })

  it('rejects a revoked code', () => {
    expect(
      canUseInviteCode(
        { maxUses: null, useCount: 0, revokedAt: new Date('2026-01-01') },
        new Date('2026-06-01'),
      ),
    ).toBe(false)
  })

  it('allows a code revoked in the future (not yet in effect)', () => {
    expect(
      canUseInviteCode(
        { maxUses: null, useCount: 0, revokedAt: new Date('2026-12-01') },
        new Date('2026-06-01'),
      ),
    ).toBe(true)
  })
})
