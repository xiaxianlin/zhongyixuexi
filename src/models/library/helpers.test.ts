/**
 * Unit tests for the library detail helpers. Pure — no DB.
 * Covers computeBookPercent (chapter-index method, RD-02 / LRN-01).
 */
import { describe, it, expect } from 'vitest'
import { computeBookPercent } from './helpers'

const chapters = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }))
const paras = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, order_index: i }))

describe('computeBookPercent', () => {
  it('returns 0 when there are no chapters', () => {
    expect(
      computeBookPercent({
        flatChapters: [],
        selectedChapterId: 'c0',
        paragraphs: [],
        selectedParagraphId: null,
      }),
    ).toBe(0)
  })

  it('returns 0 when no chapter is selected', () => {
    expect(
      computeBookPercent({
        flatChapters: chapters(3),
        selectedChapterId: null,
        paragraphs: paras(5),
        selectedParagraphId: 'p0',
      }),
    ).toBe(0)
  })

  it('returns 0 when the selected chapter is not in the book', () => {
    expect(
      computeBookPercent({
        flatChapters: chapters(3),
        selectedChapterId: 'nope',
        paragraphs: paras(5),
        selectedParagraphId: 'p0',
      }),
    ).toBe(0)
  })

  it('first chapter / first paragraph is a small positive fraction (≈1/3/5)', () => {
    // (0 + 1/5) / 3 = 0.0666...
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c0',
      paragraphs: paras(5),
      selectedParagraphId: 'p0',
    })
    expect(pct).toBeCloseTo(1 / 15, 10)
    expect(pct).toBeGreaterThan(0)
    expect(pct).toBeLessThan(1)
  })

  it('advances as the chapter index grows', () => {
    // chapter c1 first paragraph: (1 + 1/5) / 3
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c1',
      paragraphs: paras(5),
      selectedParagraphId: 'p0',
    })
    expect(pct).toBeCloseTo((1 + 1 / 5) / 3, 10)
  })

  it('clamps to exactly 1 on the last chapter / last paragraph', () => {
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c2',
      paragraphs: paras(5),
      selectedParagraphId: 'p4', // last
    })
    expect(pct).toBe(1)
  })

  it('last chapter but NOT last paragraph stays under 1', () => {
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c2',
      paragraphs: paras(5),
      selectedParagraphId: 'p0', // first of last chapter
    })
    // (2 + 1/5) / 3 = 0.7333 — on the last chapter but only its first paragraph,
    // so progress is high but must NOT round-trip to 1.
    expect(pct).toBeLessThan(1)
    expect(pct).toBeCloseTo((2 + 1 / 5) / 3, 10)
  })

  it('within-chapter fraction tracks the selected paragraph position', () => {
    // c0, middle paragraph p2 of 5 → (0 + 3/5) / 3
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c0',
      paragraphs: paras(5),
      selectedParagraphId: 'p2',
    })
    expect(pct).toBeCloseTo((3 / 5) / 3, 10)
  })

  it('treats an unknown selected paragraph as fraction 0 within the chapter', () => {
    // selectedChapter resolves (c1) but paragraph id not in list → withinFraction 0
    const pct = computeBookPercent({
      flatChapters: chapters(3),
      selectedChapterId: 'c1',
      paragraphs: paras(5),
      selectedParagraphId: 'missing',
    })
    expect(pct).toBeCloseTo(1 / 3, 10)
  })

  it('never exceeds [0,1] for a single chapter book on its only paragraph', () => {
    const pct = computeBookPercent({
      flatChapters: chapters(1),
      selectedChapterId: 'c0',
      paragraphs: paras(1),
      selectedParagraphId: 'p0',
    })
    expect(pct).toBe(1)
  })
})
