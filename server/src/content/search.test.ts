import { describe, it, expect } from 'vitest'
import { sanitizeSearchQuery } from './search'

describe('sanitizeSearchQuery', () => {
  it('trims surrounding whitespace', () => {
    expect(sanitizeSearchQuery('  脾虚  ')).toBe('脾虚')
  })

  it('caps overly long queries', () => {
    expect(sanitizeSearchQuery('a'.repeat(200))).toHaveLength(100)
  })

  it('leaves a short query untouched (no length-based fallback needed)', () => {
    expect(sanitizeSearchQuery('气')).toBe('气')
  })

  it('returns an empty string for whitespace-only input', () => {
    expect(sanitizeSearchQuery('   ')).toBe('')
  })
})
