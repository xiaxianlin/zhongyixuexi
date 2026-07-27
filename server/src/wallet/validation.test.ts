import { describe, expect, it } from 'vitest'
import { validateAdjustmentInput } from './validation'

describe('validateAdjustmentInput', () => {
  it('accepts a positive integer top-up', () => {
    expect(() => validateAdjustmentInput({ deltaTokens: 100_000 })).not.toThrow()
  })

  it('accepts a negative integer correction', () => {
    expect(() => validateAdjustmentInput({ deltaTokens: -500 })).not.toThrow()
  })

  it('rejects zero', () => {
    expect(() => validateAdjustmentInput({ deltaTokens: 0 })).toThrow()
  })

  it('rejects a non-integer delta', () => {
    expect(() => validateAdjustmentInput({ deltaTokens: 1.5 })).toThrow()
  })

  it('rejects a negative amountCny', () => {
    expect(() => validateAdjustmentInput({ deltaTokens: 100, amountCny: -10 })).toThrow()
  })

  it('accepts a missing or null amountCny', () => {
    expect(() => validateAdjustmentInput({ deltaTokens: 100 })).not.toThrow()
    expect(() => validateAdjustmentInput({ deltaTokens: 100, amountCny: null })).not.toThrow()
  })
})
