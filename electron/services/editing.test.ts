/**
 * Unit tests for parse-hash + the analyzed-flag passthrough in buildChapterTree.
 *
 * The editing service's DB writes (merge/split/editText) can't run under vitest
 * (better-sqlite3 is built for Electron's ABI), so only the pure helpers + the
 * pure tree builder are unit-tested here. The DB paths are covered by the
 * integration check (electron/main/integration-check.ts) and manual verification.
 */
import { describe, it, expect } from 'vitest'
import { sha256Hex16 } from './parse-hash'
import { buildChapterTree } from './library'

describe('sha256Hex16', () => {
  it('returns the first 16 hex chars of sha256(normalized text)', () => {
    // sha256('hello') = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256Hex16('hello')).toBe('2cf24dba5fb0a30e')
  })

  it('is stable for the same input', () => {
    expect(sha256Hex16('人参味甘微寒')).toBe(sha256Hex16('人参味甘微寒'))
  })

  it('differs when text differs', () => {
    expect(sha256Hex16('人参')).not.toBe(sha256Hex16('黄芪'))
  })

  it('produces a 16-char hex string', () => {
    expect(sha256Hex16('x')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('buildChapterTree — analyzed flag passthrough', () => {
  it('carries the analyzed field through to ChapterNode', () => {
    const rows = [
      { id: 'c1', parent_id: null, order_index: 0, title: '已分析章', analyzed: 1 },
      { id: 'c2', parent_id: null, order_index: 1, title: '未分析章', analyzed: 0 },
      { id: 'c3', parent_id: null, order_index: 2, title: '无字段默认 0' },
    ]
    const tree = buildChapterTree(rows)
    expect(tree.map((n) => n.id)).toEqual(['c1', 'c2', 'c3'])
    expect(tree[0]!.analyzed).toBe(1)
    expect(tree[1]!.analyzed).toBe(0)
    expect(tree[2]!.analyzed).toBe(0) // defaults to 0 when absent
  })
})
