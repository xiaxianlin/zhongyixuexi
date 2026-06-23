/**
 * Unit tests for the library detail helpers. Pure — no DB.
 * Covers computeBookPercent (chapter-level, v3.1: chapter index + scroll ratio).
 */
import { describe, it, expect } from 'vitest'
import { computeBookPercent } from './helpers'

const chapters = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }))

describe('computeBookPercent', () => {
  it('returns 0 when there are no chapters', () => {
    expect(
      computeBookPercent({ flatChapters: [], selectedChapterId: 'c0', scrollRatio: 0 }),
    ).toBe(0)
  })

  it('returns 0 when no chapter is selected', () => {
    expect(
      computeBookPercent({ flatChapters: chapters(3), selectedChapterId: null, scrollRatio: 0.5 }),
    ).toBe(0)
  })

  it('returns 0 when the selected chapter is not in the book', () => {
    expect(
      computeBookPercent({ flatChapters: chapters(3), selectedChapterId: 'nope', scrollRatio: 0.5 }),
    ).toBe(0)
  })

  it('first chapter at scroll 0 is 0', () => {
    expect(
      computeBookPercent({ flatChapters: chapters(3), selectedChapterId: 'c0', scrollRatio: 0 }),
    ).toBe(0)
  })

  it('first chapter half-scrolled is (0 + 0.5) / 3', () => {
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c0',
      scrollRatio: 0.5,
    })
    expect(pct).toBeCloseTo(0.5 / 3, 10)
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeLessThan(1)
  })

  it('advances as the chapter index grows', () => {
    // chapter c1, fully scrolled: (1 + 1) / 3
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c1',
      scrollRatio: 1,
    })
    expect(pct).toBeCloseTo(2 / 3, 10)
  })

  it('clamps to exactly 1 on the last chapter at full scroll', () => {
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c2',
      scrollRatio: 1,
    })
    expect(pct).toBe(1)
  })

  it('last chapter but NOT fully scrolled stays under 1', () => {
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c2',
      scrollRatio: 0.2,
    })
    // (2 + 0.2) / 3 = 0.7333
    expect(pct).toBeLessThan(1)
    expect(pct).toBeCloseTo(2.2 / 3, 10)
  })

  it('scroll ratio is clamped to [0,1]', () => {
    const hi = computeBookPercent({
      flatChapters: chapters(2),
      selectedChapterId: 'c0',
      scrollRatio: 5,
    })
    const lo = computeBookPercent({
      flatChapters: chapters(2),
      selectedChapterId: 'c0',
      scrollRatio: -3,
    })
    expect(hi).toBeCloseTo(0.5, 10) // (0 + 1) / 2
    expect(lo).toBe(0)
  })

  it('single chapter at full scroll is 1', () => {
    const pct = computeBookPercent({
      flatChapters: chapters(1),
      selectedChapterId: 'c0',
      scrollRatio: 1,
    })
    expect(pct).toBe(1)
  })
})
