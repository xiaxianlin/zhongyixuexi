import { describe, it, expect } from 'vitest'
import { meetsTier, resolveAccessTier, type WalletBalanceLookup } from './tier'

describe('meetsTier', () => {
  it('guest meets guest but not free_member or paid_member', () => {
    expect(meetsTier('guest', 'guest')).toBe(true)
    expect(meetsTier('guest', 'free_member')).toBe(false)
    expect(meetsTier('guest', 'paid_member')).toBe(false)
  })

  it('free_member meets guest and free_member but not paid_member', () => {
    expect(meetsTier('free_member', 'guest')).toBe(true)
    expect(meetsTier('free_member', 'free_member')).toBe(true)
    expect(meetsTier('free_member', 'paid_member')).toBe(false)
  })

  it('paid_member meets every tier', () => {
    expect(meetsTier('paid_member', 'guest')).toBe(true)
    expect(meetsTier('paid_member', 'free_member')).toBe(true)
    expect(meetsTier('paid_member', 'paid_member')).toBe(true)
  })
})

describe('resolveAccessTier', () => {
  const zeroBalance: WalletBalanceLookup = { getBalance: async () => 0 }
  const positiveBalance: WalletBalanceLookup = { getBalance: async () => 500 }

  it('an unauthenticated request is a guest', async () => {
    expect(await resolveAccessTier({ userId: null, role: null }, zeroBalance)).toBe('guest')
  })

  it('a member with zero balance is a free member', async () => {
    expect(await resolveAccessTier({ userId: 'u1', role: 'member' }, zeroBalance)).toBe(
      'free_member',
    )
  })

  it('a member with a positive balance is a paid member', async () => {
    expect(await resolveAccessTier({ userId: 'u1', role: 'member' }, positiveBalance)).toBe(
      'paid_member',
    )
  })

  it('an admin is always a paid member regardless of balance', async () => {
    expect(await resolveAccessTier({ userId: 'u1', role: 'admin' }, zeroBalance)).toBe(
      'paid_member',
    )
  })
})
