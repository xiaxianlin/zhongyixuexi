/**
 * Unit tests for the snippet <mark> parser (05-search.md §10.3). Pure — no DB.
 * Covers FTS5 snippet() and the LIKE-downgrade snippet shapes from search.ts.
 */
import { describe, it, expect } from 'vitest'
import { parseSnippet } from './snippet'

describe('parseSnippet', () => {
  it('returns [] for empty input', () => {
    expect(parseSnippet('')).toEqual([])
  })

  it('returns a single plain segment when there is no mark', () => {
    expect(parseSnippet('人参味甘')).toEqual([{ text: '人参味甘', mark: false }])
  })

  it('extracts a single <mark> with surrounding text', () => {
    const out = parseSnippet('前文 <mark>脾虚</mark> 后文')
    expect(out).toEqual([
      { text: '前文 ', mark: false },
      { text: '脾虚', mark: true },
      { text: ' 后文', mark: false },
    ])
  })

  it('handles a mark at the start', () => {
    expect(parseSnippet('<mark>人参</mark>味甘')).toEqual([
      { text: '人参', mark: true },
      { text: '味甘', mark: false },
    ])
  })

  it('handles a mark at the end', () => {
    expect(parseSnippet('味甘<mark>微寒</mark>')).toEqual([
      { text: '味甘', mark: false },
      { text: '微寒', mark: true },
    ])
  })

  it('handles multiple marks', () => {
    expect(parseSnippet('<mark>脾</mark>胃<mark>虚</mark>弱')).toEqual([
      { text: '脾', mark: true },
      { text: '胃', mark: false },
      { text: '虚', mark: true },
      { text: '弱', mark: false },
    ])
  })

  it('keeps stray < or > outside a mark as ordinary text', () => {
    // A literal angle bracket from source text is NOT treated as markup.
    expect(parseSnippet('a < b <mark>x</mark>')).toEqual([
      { text: 'a < b ', mark: false },
      { text: 'x', mark: true },
    ])
  })

  it('keeps an unclosed <mark> as plain text (no match)', () => {
    expect(parseSnippet('前文 <mark>未闭合')).toEqual([
      { text: '前文 <mark>未闭合', mark: false },
    ])
  })

  it('preserves the FTS5 ellipsis " … " as plain text', () => {
    const out = parseSnippet(' … 味甘<mark>微寒</mark> … ')
    expect(out.map((s) => s.text).join('|')).toBe(' … 味甘|微寒| … ')
    expect(out[1]!.mark).toBe(true)
  })
})
