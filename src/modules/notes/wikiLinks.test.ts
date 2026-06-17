/**
 * Unit tests for NOTE module pure functions (06-notes.md §10.1).
 *
 * Covers:
 *  1. parseWikiLinks — all [[ ]] syntax variants, edge cases, dedup, position.
 *  2. resolveTarget — priority cascade (precise > uuid > paragraph > chapter > note).
 *  3. splitWikiLinks — renderer-side segment splitting.
 *
 * These pure functions live in src/modules/notes/wikiLinks.ts (renderer-side
 * canonical copy) because electron/services/notes.ts imports better-sqlite3 +
 * electron at the top level, which cannot load under vitest/node (ABI mismatch).
 * The service mirrors these implementations — keep in sync.
 */

import { describe, it, expect } from 'vitest'
import {
  parseWikiLinks,
  resolveTarget,
  parsePreciseTarget,
  looksLikeUuid,
  splitWikiLinks,
  type TargetLookup,
} from './wikiLinks'

// ---------------------------------------------------------------------------
// Mock lookup for resolveTarget tests
// ---------------------------------------------------------------------------

/** Build a mock TargetLookup with controllable entity existence. */
function makeMockLookup(opts: {
  paragraphs?: string[]
  chapters?: string[]
  notes?: string[]
  paragraphTitles?: Record<string, string>
  chapterTitles?: Record<string, string>
  noteTitles?: Record<string, string>
}): TargetLookup {
  return {
    entityExists(type, id) {
      if (type === 'paragraph') return (opts.paragraphs ?? []).includes(id)
      if (type === 'chapter') return (opts.chapters ?? []).includes(id)
      if (type === 'note') return (opts.notes ?? []).includes(id)
      return false
    },
    findParagraphByTitleLike(text) {
      for (const [pid, ptitle] of Object.entries(opts.paragraphTitles ?? {})) {
        if (ptitle.includes(text) || text.includes(ptitle)) return pid
      }
      return null
    },
    findChapterByTitleLike(text) {
      for (const [cid, ctitle] of Object.entries(opts.chapterTitles ?? {})) {
        if (ctitle.includes(text) || text.includes(ctitle)) return cid
      }
      return null
    },
    findNoteByTitleLike(text) {
      for (const [nid, ntitle] of Object.entries(opts.noteTitles ?? {})) {
        if (ntitle.includes(text) || text.includes(ntitle)) return nid
      }
      return null
    },
  }
}

const UUID_A = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
const UUID_B = 'b1b2c3d4-e5f6-7890-abcd-ef1234567890'

// ---------------------------------------------------------------------------
// parseWikiLinks
// ---------------------------------------------------------------------------

describe('parseWikiLinks', () => {
  it('returns [] for empty string', () => {
    expect(parseWikiLinks('')).toEqual([])
  })

  it('returns [] when no links present', () => {
    expect(parseWikiLinks('just plain text with no links')).toEqual([])
  })

  it('parses a simple [[target]]', () => {
    const result = parseWikiLinks('hello [[world]] end')
    expect(result).toHaveLength(1)
    expect(result[0]!.rawTarget).toBe('world')
    expect(result[0]!.displayText).toBe('world')
    expect(result[0]!.offset).toBe(6)
  })

  it('parses [[type:id]] precise syntax', () => {
    const result = parseWikiLinks('see [[paragraph:abc-123]] here')
    expect(result).toHaveLength(1)
    expect(result[0]!.rawTarget).toBe('paragraph:abc-123')
    expect(result[0]!.displayText).toBe('paragraph:abc-123')
  })

  it('parses [[target|alias]] pipe syntax', () => {
    const result = parseWikiLinks('ref [[some-target|显示文本]]')
    expect(result).toHaveLength(1)
    expect(result[0]!.rawTarget).toBe('some-target')
    expect(result[0]!.displayText).toBe('显示文本')
  })

  it('parses [[type:id|alias]] combined syntax', () => {
    const result = parseWikiLinks('link [[paragraph:uuid-1|这段讲人参]]')
    expect(result).toHaveLength(1)
    expect(result[0]!.rawTarget).toBe('paragraph:uuid-1')
    expect(result[0]!.displayText).toBe('这段讲人参')
  })

  it('parses multiple links in sequence', () => {
    const result = parseWikiLinks('[[a]] and [[b]] and [[c]]')
    expect(result).toHaveLength(3)
    expect(result[0]!.rawTarget).toBe('a')
    expect(result[1]!.rawTarget).toBe('b')
    expect(result[2]!.rawTarget).toBe('c')
  })

  it('records correct offsets for multiple links', () => {
    const md = '[[a]] mid [[b]]'
    const result = parseWikiLinks(md)
    expect(result[0]!.offset).toBe(0)
    expect(result[1]!.offset).toBe(10) // [[b]] starts at index 10 in "[[a]] mid [[b]]"
  })

  it('ignores unclosed [[', () => {
    const result = parseWikiLinks('text [[unclosed here')
    expect(result).toEqual([])
  })

  it('ignores empty [[]]', () => {
    const result = parseWikiLinks('text [[]] end')
    expect(result).toEqual([])
  })

  it('handles pipe with empty alias (falls back to target)', () => {
    const result = parseWikiLinks('[[target|]]')
    expect(result).toHaveLength(1)
    expect(result[0]!.rawTarget).toBe('target')
    expect(result[0]!.displayText).toBe('target')
  })

  it('trims whitespace inside [[ ]]', () => {
    const result = parseWikiLinks('[[  target  ]]')
    expect(result).toHaveLength(1)
    expect(result[0]!.rawTarget).toBe('target')
  })

  it('trims whitespace around pipe', () => {
    const result = parseWikiLinks('[[target  |  alias]]')
    expect(result).toHaveLength(1)
    expect(result[0]!.rawTarget).toBe('target')
    expect(result[0]!.displayText).toBe('alias')
  })

  it('does not match nested brackets [[a[b]c]]', () => {
    // The regex [^\[\]]+ excludes inner brackets, so [[a[b]] does not match.
    // [[a]] text [[b]] would match separately.
    const result = parseWikiLinks('[[a[b]]')
    // [[a[b]] — the regex sees [[ then tries to match non-bracket chars, but
    // hits [ which is excluded. So it can't match until ]]. This whole thing
    // doesn't form a valid [[...]] with non-bracket inner.
    // Actually: [[a[b]] — regex tries \[\[([^\[\]]+)\]\]. Starting at index 0:
    // [[ then a (ok) then [ (not allowed by [^\[\]]). No match at this position.
    // It tries next positions. At index 1: [a[b]] — starts with single [, no match.
    // So no valid links found.
    expect(result).toEqual([])
  })

  it('handles CJK content in links', () => {
    const result = parseWikiLinks('参考 [[人参]] 和 [[黄芪|补气]]')
    expect(result).toHaveLength(2)
    expect(result[0]!.rawTarget).toBe('人参')
    expect(result[1]!.rawTarget).toBe('黄芪')
    expect(result[1]!.displayText).toBe('补气')
  })
})

// ---------------------------------------------------------------------------
// resolveTarget — priority cascade
// ---------------------------------------------------------------------------

describe('resolveTarget', () => {
  it('(a) precise type:id — returns valid when entity exists', () => {
    const lookup = makeMockLookup({ paragraphs: [UUID_A] })
    const result = resolveTarget(`paragraph:${UUID_A}`, lookup)
    expect(result).toEqual({
      targetType: 'paragraph',
      targetId: UUID_A,
      valid: true,
    })
  })

  it('(a) precise type:id — returns invalid when entity does not exist', () => {
    const lookup = makeMockLookup({ paragraphs: [] })
    const result = resolveTarget('paragraph:nonexistent-id', lookup)
    expect(result).toEqual({
      targetType: 'paragraph',
      targetId: 'nonexistent-id',
      valid: false,
    })
  })

  it('(a) precise type:id — works for chapter', () => {
    const lookup = makeMockLookup({ chapters: [UUID_A] })
    const result = resolveTarget(`chapter:${UUID_A}`, lookup)
    expect(result!.targetType).toBe('chapter')
    expect(result!.valid).toBe(true)
  })

  it('(a) precise type:id — works for note', () => {
    const lookup = makeMockLookup({ notes: [UUID_A] })
    const result = resolveTarget(`note:${UUID_A}`, lookup)
    expect(result!.targetType).toBe('note')
    expect(result!.valid).toBe(true)
  })

  it('(b) bare UUID — matches paragraph first', () => {
    const lookup = makeMockLookup({
      paragraphs: [UUID_A],
      chapters: [UUID_A], // also a chapter with same id (unlikely but tests priority)
    })
    const result = resolveTarget(UUID_A, lookup)
    expect(result!.targetType).toBe('paragraph')
    expect(result!.valid).toBe(true)
  })

  it('(b) bare UUID — falls through to chapter if not a paragraph', () => {
    const lookup = makeMockLookup({
      paragraphs: [],
      chapters: [UUID_B],
    })
    const result = resolveTarget(UUID_B, lookup)
    expect(result!.targetType).toBe('chapter')
    expect(result!.valid).toBe(true)
  })

  it('(b) bare UUID — returns null if neither paragraph nor chapter', () => {
    const lookup = makeMockLookup({
      paragraphs: [],
      chapters: [],
    })
    const result = resolveTarget(UUID_A, lookup)
    expect(result).toBeNull()
  })

  it('(c) fuzzy paragraph title match takes priority over chapter', () => {
    const lookup = makeMockLookup({
      paragraphTitles: { 'para-1': '人参味甘' },
      chapterTitles: { 'chap-1': '人参' },
    })
    const result = resolveTarget('人参', lookup)
    expect(result!.targetType).toBe('paragraph')
    expect(result!.targetId).toBe('para-1')
  })

  it('(d) fuzzy chapter title match when no paragraph matches', () => {
    const lookup = makeMockLookup({
      paragraphTitles: {},
      chapterTitles: { 'chap-1': '上品' },
    })
    const result = resolveTarget('上品', lookup)
    expect(result!.targetType).toBe('chapter')
    expect(result!.targetId).toBe('chap-1')
  })

  it('(e) note title match when no paragraph or chapter matches', () => {
    const lookup = makeMockLookup({
      paragraphTitles: {},
      chapterTitles: {},
      noteTitles: { 'note-1': '我的笔记' },
    })
    const result = resolveTarget('我的笔记', lookup)
    expect(result!.targetType).toBe('note')
    expect(result!.targetId).toBe('note-1')
  })

  it('(f) returns null when nothing matches', () => {
    const lookup = makeMockLookup({
      paragraphTitles: {},
      chapterTitles: {},
      noteTitles: {},
    })
    const result = resolveTarget('未知术语', lookup)
    expect(result).toBeNull()
  })

  it('priority: precise type:id beats fuzzy title', () => {
    // Even if a fuzzy match exists, precise syntax with existing entity wins.
    const lookup = makeMockLookup({
      paragraphs: ['precise-id'],
      paragraphTitles: { 'fuzzy-id': 'target text' },
    })
    const result = resolveTarget('paragraph:precise-id', lookup)
    expect(result!.targetId).toBe('precise-id')
    expect(result!.valid).toBe(true)
  })

  it('priority: paragraph fuzzy beats note fuzzy', () => {
    const lookup = makeMockLookup({
      paragraphTitles: { 'p1': 'test' },
      noteTitles: { 'n1': 'test' },
    })
    const result = resolveTarget('test', lookup)
    expect(result!.targetType).toBe('paragraph')
  })
})

// parsePreciseTarget
// ---------------------------------------------------------------------------

describe('parsePreciseTarget', () => {
  it('parses paragraph:id', () => {
    expect(parsePreciseTarget('paragraph:abc-123')).toEqual({
      type: 'paragraph',
      id: 'abc-123',
    })
  })

  it('parses chapter:id', () => {
    expect(parsePreciseTarget('chapter:xyz')).toEqual({
      type: 'chapter',
      id: 'xyz',
    })
  })

  it('returns null for unsupported target type', () => {
    expect(parsePreciseTarget('term:人参')).toBeNull()
  })

  it('parses note:id', () => {
    expect(parsePreciseTarget('note:uuid-here')).toEqual({
      type: 'note',
      id: 'uuid-here',
    })
  })

  it('is case-insensitive for type prefix', () => {
    expect(parsePreciseTarget('PARAGRAPH:abc')).toEqual({
      type: 'paragraph',
      id: 'abc',
    })
  })

  it('returns null for non-precise syntax', () => {
    expect(parsePreciseTarget('some title')).toBeNull()
  })

  it('returns null for unknown type prefix', () => {
    expect(parsePreciseTarget('book:abc')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// looksLikeUuid
// ---------------------------------------------------------------------------

describe('looksLikeUuid', () => {
  it('returns true for a valid UUID', () => {
    expect(looksLikeUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true)
  })

  it('returns true for uppercase UUID', () => {
    expect(looksLikeUuid('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe(true)
  })

  it('returns false for a plain string', () => {
    expect(looksLikeUuid('some title')).toBe(false)
  })

  it('returns false for a partial UUID', () => {
    expect(looksLikeUuid('a1b2c3d4-e5f6')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(looksLikeUuid('')).toBe(false)
  })

  it('handles leading/trailing whitespace', () => {
    expect(looksLikeUuid('  a1b2c3d4-e5f6-7890-abcd-ef1234567890  ')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// splitWikiLinks (renderer-side)
// ---------------------------------------------------------------------------

describe('splitWikiLinks', () => {
  it('returns single plain segment when no links', () => {
    const result = splitWikiLinks('just text')
    expect(result).toEqual([{ text: 'just text', isWikiLink: false }])
  })

  it('returns [] for empty string', () => {
    expect(splitWikiLinks('')).toEqual([])
  })

  it('splits text around a single link', () => {
    const result = splitWikiLinks('before [[link]] after')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ text: 'before ', isWikiLink: false })
    expect(result[1]).toEqual({
      text: '[[link]]',
      isWikiLink: true,
      displayText: 'link',
      rawTarget: 'link',
    })
    expect(result[2]).toEqual({ text: ' after', isWikiLink: false })
  })

  it('handles link at start of text', () => {
    const result = splitWikiLinks('[[link]] tail')
    expect(result).toHaveLength(2)
    expect(result[0]!.isWikiLink).toBe(true)
    expect(result[1]).toEqual({ text: ' tail', isWikiLink: false })
  })

  it('handles link at end of text', () => {
    const result = splitWikiLinks('head [[link]]')
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ text: 'head ', isWikiLink: false })
    expect(result[1]!.isWikiLink).toBe(true)
  })

  it('handles multiple consecutive links', () => {
    const result = splitWikiLinks('[[a]][[b]]')
    expect(result).toHaveLength(2)
    expect(result[0]!.rawTarget).toBe('a')
    expect(result[1]!.rawTarget).toBe('b')
  })

  it('extracts display text from pipe syntax', () => {
    const result = splitWikiLinks('[[target|display]]')
    expect(result[0]!.displayText).toBe('display')
    expect(result[0]!.rawTarget).toBe('target')
  })

  it('handles type:id syntax', () => {
    const result = splitWikiLinks('see [[paragraph:uuid]]')
    const link = result.find((s) => s.isWikiLink)!
    expect(link.rawTarget).toBe('paragraph:uuid')
    expect(link.displayText).toBe('paragraph:uuid')
  })

  it('handles CJK link targets', () => {
    const result = splitWikiLinks('参考 [[人参]]')
    expect(result.find((s) => s.isWikiLink)?.rawTarget).toBe('人参')
  })
})
