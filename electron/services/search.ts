/**
 * Search service — full-text search over chapter content (v3.1 chapter model).
 *
 * Schema note: fts_chapters (FTS5, trigram) indexes chapters.content; the
 * implicit `rowid` on chapters is what fts_chapters keys on via
 * content_rowid='rowid'.
 *
 * trigram tokenizer: needs >= 3 characters to match, so 1–2 char queries are
 * downgraded to a LIKE substring scan over chapters.content (no BM25; ordered
 * by book/order_index for stable output).
 */

import { getDb } from '../db/connection'
import { AppError } from '../lib/error'

// ---------- DTOs ----------

export interface SearchHit {
  chapterId: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  /** Snippet with <mark>...</mark> around matched terms (FTS5 snippet()). */
  snippet: string
  /** bm25 score — LOWER is more relevant. 0 for the LIKE downgrade path. */
  score: number
  /** Code-point offset of the first match within chapters.content, for the
   *  reading pane to scroll to. -1 when unknown. */
  matchOffset: number
}

export interface SearchResult {
  total: number
  hits: SearchHit[]
  /** true when the query was too short for trigram and ran a LIKE scan instead. */
  degraded: boolean
}

// ---------- pure helpers (exported for unit testing) ----------

/**
 * Count CJK-ish "characters" the trigram tokenizer would consume. trigram
 * operates on UTF-8 *code points* and needs >= 3 of them to form a single
 * trigram, so we measure by code-point length, not UTF-16 .length (surrogate
 * pairs / astral chars count as one code point). ASCII queries < 3 code points
 * also downgrade (e.g. a 2-letter latin search), matching trigram behavior.
 */
export function countCodePoints(s: string): number {
  // Array.from splits on code points (not UTF-16 units).
  return Array.from(s.trim()).length
}

/** True when the query is too short for the trigram tokenizer to index it. */
export function isShortQuery(q: string): boolean {
  return countCodePoints(q) < 3
}

/**
 * Build a safe FTS5 MATCH expression for the trigram tokenizer.
 *
 * trigram matches substrings, so the raw query string works as a phrase — but
 * FTS5 syntax reserves a set of characters (`"`, `*`, `(`, `)`, `:`, `-`, etc.)
 * that, if unescaped, get parsed as operators and raise a query-syntax error.
 * Wrapping the whole query in double quotes makes it a single phrase literal;
 * any embedded `"` is doubled (`""`) per the FTS5 string-escaping rule.
 */
export function buildFtsMatch(q: string): string {
  const trimmed = q.trim()
  const escaped = trimmed.replace(/"/g, '""')
  return `"${escaped}"`
}

// ---------- fulltext search (S3.1) ----------

export interface SearchOpts {
  limit?: number
  offset?: number
  /** Restrict to a set of books; empty/undefined = all books. */
  bookIds?: string[]
}

/**
 * Cross-library full-text search over chapter content.
 *
 * Path selection:
 *  - < 3 code points → LIKE '%q%' scan, ordered by book/order_index, no BM25.
 *  - otherwise      → FTS5 MATCH + bm25() ranking + snippet() highlight.
 *
 * Both paths JOIN chapters→books for titles, filter to live chapters
 * (deleted_at IS NULL), and optionally scope to bookIds.
 */
export function searchChapters(q: string, opts: SearchOpts = {}): SearchResult {
  const query = (q ?? '').trim()
  if (query === '') return { total: 0, hits: [], degraded: false }

  const db = getDb()
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  const offset = Math.max(0, opts.offset ?? 0)
  const bookIds = opts.bookIds?.filter((b) => typeof b === 'string' && b.length > 0) ?? []
  const bookFilter = bookIds.length > 0

  const COLUMNS = `
    c.id            AS chapterId,
    c.book_id       AS bookId,
    b.title         AS bookTitle,
    c.title         AS chapterTitle`

  if (isShortQuery(query)) {
    // Downgrade: trigram cannot index < 3 code-point tokens. Scan chapters.
    const like = `%${query}%`
    const rows = db
      .prepare(
        `SELECT ${COLUMNS},
                c.content AS text,
                0 AS score
         FROM chapters c
         JOIN books b ON b.id = c.book_id
         WHERE c.deleted_at IS NULL
           AND c.content LIKE ?
           ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}
         ORDER BY c.book_id, c.order_index
         LIMIT ? OFFSET ?`,
      )
      .all(...[like, ...(bookFilter ? bookIds : []), limit, offset]) as Array<
      Omit<SearchHit, 'snippet' | 'matchOffset'> & { text: string }
    >

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM chapters c
         WHERE c.deleted_at IS NULL
           AND c.content LIKE ?
           ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}`,
      )
      .get(...[like, ...(bookFilter ? bookIds : [])]) as { n: number }

    return {
      total: totalRow.n,
      hits: rows.map((r) => {
        const { text, ...rest } = r
        return { ...rest, ...makeLikeSnippet(text, query) }
      }),
      degraded: true,
    }
  }

  // FTS5 path. snippet() wraps matches in <mark>; bm25() ranks (lower = better).
  const match = buildFtsMatch(query)
  let rows: Array<
    Omit<SearchHit, 'snippet' | 'matchOffset'> & { snippet?: string; text: string }
  >
  try {
    rows = db
      .prepare(
        `SELECT ${COLUMNS},
                snippet(fts_chapters, 0, '<mark>', '</mark>', ' … ', 24) AS snippet,
                c.content AS text,
                bm25(fts_chapters) AS score
         FROM fts_chapters
         JOIN chapters c ON c.rowid = fts_chapters.rowid
         JOIN books    b ON b.id = c.book_id
         WHERE fts_chapters MATCH ?
           AND c.deleted_at IS NULL
           ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}
         ORDER BY rank
         LIMIT ? OFFSET ?`,
      )
      .all(...[match, ...(bookFilter ? bookIds : []), limit, offset]) as typeof rows
  } catch (err) {
    throw new AppError(
      'VALIDATION',
      `检索词包含非法字符或语法错误：${(err as Error).message}`,
    )
  }

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM fts_chapters
       JOIN chapters c ON c.rowid = fts_chapters.rowid
       WHERE fts_chapters MATCH ?
         AND c.deleted_at IS NULL
         ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}`,
    )
    .get(...[match, ...(bookFilter ? bookIds : [])]) as { n: number }

  return {
    total: totalRow.n,
    hits: rows.map((r) => {
      const { text, snippet, ...rest } = r
      return {
        ...rest,
        snippet: snippet ?? '',
        matchOffset: indexOfCodepoint(text, query),
      }
    }),
    degraded: false,
  }
}

/** Code-point index of the first occurrence of `term` in `text` (-1 if absent). */
function indexOfCodepoint(text: string, term: string): number {
  const cps = Array.from(text)
  const termCps = Array.from(term)
  for (let i = 0; i + termCps.length <= cps.length; i++) {
    let ok = true
    for (let j = 0; j < termCps.length; j++) {
      if (cps[i + j] !== termCps[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

/** Build a ?,?,? placeholder string of length n. */
function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',')
}

/**
 * Build a <mark>-wrapped snippet + matchOffset for the LIKE downgrade path.
 * Pure (no DB): given the full chapter text and the (short) query, center a
 * window on the first match, wrap the matched substring in <mark>, and emit the
 * FTS5-style ellipsis when truncated. Exported for unit testing.
 *
 * Window width is ~32 code points to roughly match FTS5 snippet(..., 24 tokens)
 * visual density for short CJK terms.
 */
export function makeLikeSnippet(
  text: string,
  term: string,
  window = 32,
): { snippet: string; matchOffset: number } {
  const cps = Array.from(text)
  const termCps = Array.from(term)
  if (cps.length === 0 || termCps.length === 0) return { snippet: '', matchOffset: -1 }

  // find first occurrence (code-point index)
  let start = -1
  for (let i = 0; i + termCps.length <= cps.length; i++) {
    let ok = true
    for (let j = 0; j < termCps.length; j++) {
      if (cps[i + j] !== termCps[j]) {
        ok = false
        break
      }
    }
    if (ok) {
      start = i
      break
    }
  }
  if (start === -1) return { snippet: cps.slice(0, window).join(''), matchOffset: -1 }

  const half = Math.floor(window / 2)
  let lo = start - half
  if (lo < 0) lo = 0
  let hi = lo + window
  if (hi > cps.length) hi = cps.length
  // keep the full match inside the window
  if (start + termCps.length > hi) {
    hi = start + termCps.length
    lo = Math.max(0, hi - window)
  }

  const before = cps.slice(lo, start).join('')
  const match = cps.slice(start, start + termCps.length).join('')
  const after = cps.slice(start + termCps.length, hi).join('')
  const prefix = lo > 0 ? ' … ' : ''
  const suffix = hi < cps.length ? ' … ' : ''
  return {
    snippet: `${prefix}${before}<mark>${match}</mark>${after}${suffix}`,
    matchOffset: start,
  }
}
