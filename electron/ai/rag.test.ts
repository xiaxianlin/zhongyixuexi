/**
 * Unit tests for RAG helpers (07-ai.md §12.1).
 *
 * Covers: <mark> stripping, snippet capping, and SearchHit→QaContext conversion
 * (1-based numbering, paragraphId injection, topK clamping). Pure transforms,
 * no DB.
 */
import { describe, it, expect } from 'vitest'
import { stripMarks, capSnippet, hitsToContext } from './rag'
import type { SearchHit } from '../services/search'

function fakeHit(paragraphId: string, snippet: string, bookTitle = '本经'): SearchHit {
  return {
    paragraphId,
    chapterId: 'c1',
    bookId: 'b1',
    bookTitle,
    chapterTitle: '上品',
    snippet,
    score: -1,
    orderIndex: 0,
  }
}

describe('stripMarks', () => {
  it('removes <mark> open and close tags', () => {
    expect(stripMarks('a <mark>人</mark>参')).toBe('a 人参')
  })
  it('handles empty input', () => {
    expect(stripMarks('')).toBe('')
  })
})

describe('capSnippet', () => {
  it('returns the string unchanged when under the cap', () => {
    expect(capSnippet('短文本', 10)).toBe('短文本')
  })
  it('truncates and adds ellipsis by code-point length', () => {
    const s = '一二三四五六七八九十' // 10 chars
    const out = capSnippet(s, 5)
    expect(Array.from(out).length).toBe(6) // 5 + ellipsis
    expect(out.endsWith('…')).toBe(true)
  })
  it('default cap is 220 code points', () => {
    const s = 'x'.repeat(300)
    expect(Array.from(capSnippet(s)).length).toBe(221)
  })
})

describe('hitsToContext', () => {
  it('numbers contexts 1..k', () => {
    const ctx = hitsToContext([fakeHit('p1', 'a'), fakeHit('p2', 'b'), fakeHit('p3', 'c')], 3)
    expect(ctx.map((c) => c.n)).toEqual([1, 2, 3])
  })
  it('injects paragraphId from the hit', () => {
    const ctx = hitsToContext([fakeHit('pabc', '人参')], 5)
    expect(ctx[0].paragraphId).toBe('pabc')
  })
  it('strips <mark> tags from the snippet', () => {
    const ctx = hitsToContext([fakeHit('p1', '<mark>人</mark>参')], 5)
    expect(ctx[0].snippet).toBe('人参')
  })
  it('clamps to topK and caps at 10', () => {
    const hits = Array.from({ length: 12 }, (_, i) => fakeHit(`p${i}`, 'x'))
    expect(hitsToContext(hits, 5).length).toBe(5)
    expect(hitsToContext(hits, 99).length).toBe(10)
  })
  it('clamps to at least 1', () => {
    const hits = [fakeHit('p1', 'x'), fakeHit('p2', 'y')]
    expect(hitsToContext(hits, 0).length).toBe(1)
  })
})
