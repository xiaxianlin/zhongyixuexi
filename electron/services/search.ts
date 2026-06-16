/**
 * Search service (SRH module) — S3.1 full-text + S3.3 terminology dictionary.
 *
 * Owns (05-search.md):
 *  - fulltext search over the IMP-owned fts_paragraphs FTS5 table (READ ONLY —
 *    00-architecture §5.4: SRH never writes fts_paragraphs, IMP does).
 *  - the dictionary_terms / term_occurrences CRUD (SRH-04).
 *
 * Schema note (library.ts): the real columns use `id` (not `book_id`/
 * `chapter_id`/`paragraph_id`) as the stable TEXT primary key on
 * books/chapters/paragraphs. paragraphs also has the implicit `rowid` that
 * fts_paragraphs keys on via content_rowid='rowid'.
 *
 * trigram tokenizer (05-search.md §4.1.4): needs >= 3 characters to match, so
 * 1–2 char queries are downgraded to a LIKE substring scan over paragraphs.text
 * (no BM25; ordered by chapter/order_index for stable, predictable output).
 */

import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'

// ---------- DTOs (self-contained; renderer mirrors in src/lib/types.ts) ----------

export interface SearchHit {
  paragraphId: string
  chapterId: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  /** Snippet with <mark>...</mark> around matched terms (FTS5 snippet()). */
  snippet: string
  /** bm25 score — LOWER is more relevant. 0 for the LIKE downgrade path. */
  score: number
  /** Paragraph order_index within its chapter (result ordering / context). */
  orderIndex: number
}

export interface SearchResult {
  total: number
  hits: SearchHit[]
  /** true when the query was too short for trigram and ran a LIKE scan instead. */
  degraded: boolean
}

export interface HighlightLoc {
  paragraphId: string
  chapterId: string
  bookId: string
  /** Match count in this paragraph. */
  count: number
}

export interface Term {
  termId: string
  term: string
  definition: string | null
  source: string | null
  category: string | null
  attributes: string | null
  createdBy: string
  paragraphId: string | null
  createdAt: number
  updatedAt: number
}

export interface TermOccurrence {
  paragraphId: string
  chapterId: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  count: number
}

export interface TermDetail extends Term {
  occurrences: TermOccurrence[]
}

/** Input for upsert — id/timestamps are server-assigned. */
export interface TermInput {
  term: string
  definition?: string | null
  source?: string | null
  category?: string | null
  attributes?: string | null
  createdBy?: string
  paragraphId?: string | null
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
 *
 * Exported so the AI module's RAG path (Phase 5) reuses the exact same escape.
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
 * Cross-library full-text search (SRH-01).
 *
 * Exported (and re-exported from electron/ipc/search.ts) for the AI module's
 * RAG retrieval (AI-02, Phase 5) — keep this signature stable:
 *   searchParagraphs(q, opts?) => SearchResult
 *
 * Path selection (05-search.md §7.2):
 *  - < 3 code points → LIKE '%q%' scan, ordered by chapter/order_index, no BM25.
 *  - otherwise      → FTS5 MATCH + bm25() ranking + snippet() highlight.
 *
 * Both paths JOIN paragraphs→chapters→books for titles, filter to live
 * (deleted_at IS NULL) non-noise (is_noise = 0) paragraphs, and optionally
 * scope to bookIds. Ghost rows (FTS hit whose paragraph was deleted) cannot
 * occur because the JOIN on paragraphs drops them; the trigger layer keeps
 * fts in sync, and even a stale row yields no join partner so it is skipped.
 */
export function searchParagraphs(q: string, opts: SearchOpts = {}): SearchResult {
  const query = (q ?? '').trim()
  if (query === '') return { total: 0, hits: [], degraded: false }

  const db = getDb()
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500))
  const offset = Math.max(0, opts.offset ?? 0)
  const bookIds = opts.bookIds?.filter((b) => typeof b === 'string' && b.length > 0) ?? []
  const bookFilter = bookIds.length > 0

  // Shared column list so the LIKE + FTS rows map into the same row shape.
  const COLUMNS = `
    p.id            AS paragraphId,
    p.chapter_id    AS chapterId,
    c.book_id       AS bookId,
    b.title         AS bookTitle,
    c.title         AS chapterTitle,
    p.order_index   AS orderIndex`

  if (isShortQuery(query)) {
    // Downgrade: trigram cannot index < 3 code-point tokens. Scan paragraphs.
    // Fetch text alongside so we can build a <mark>-wrapped snippet in-process
    // (FTS5 snippet() is unavailable on the LIKE path).
    const like = `%${query}%`
    const rows = db
      .prepare(
        `SELECT ${COLUMNS},
                p.text AS text,
                0 AS score
         FROM paragraphs p
         JOIN chapters c ON c.id = p.chapter_id
         JOIN books    b ON b.id = c.book_id
         WHERE p.deleted_at IS NULL
           AND p.is_noise = 0
           AND p.text LIKE ?
           ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}
         ORDER BY c.book_id, p.chapter_id, p.order_index
         LIMIT ? OFFSET ?`,
      )
      .all(...[like, ...(bookFilter ? bookIds : []), limit, offset]) as Array<
      Omit<SearchHit, 'snippet'> & { text: string }
    >

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM paragraphs p
         JOIN chapters c ON c.id = p.chapter_id
         WHERE p.deleted_at IS NULL
           AND p.is_noise = 0
           AND p.text LIKE ?
           ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}`,
      )
      .get(...[like, ...(bookFilter ? bookIds : [])]) as { n: number }

    return {
      total: totalRow.n,
      hits: rows.map((r) => {
        const { text, ...rest } = r
        return { ...rest, snippet: makeLikeSnippet(text, query) }
      }),
      degraded: true,
    }
  }

  // FTS5 path. snippet() wraps matches in <mark>; bm25() ranks (lower = better).
  const match = buildFtsMatch(query)
  let rows: Array<Omit<SearchHit, 'snippet'> & { snippet?: string }>
  try {
    rows = db
      .prepare(
        `SELECT ${COLUMNS},
                snippet(fts_paragraphs, 0, '<mark>', '</mark>', ' … ', 24) AS snippet,
                bm25(fts_paragraphs) AS score
         FROM fts_paragraphs
         JOIN paragraphs p ON p.rowid = fts_paragraphs.rowid
         JOIN chapters c ON c.id = p.chapter_id
         JOIN books    b ON b.id = c.book_id
         WHERE fts_paragraphs MATCH ?
           AND p.deleted_at IS NULL
           AND p.is_noise = 0
           ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}
         ORDER BY rank
         LIMIT ? OFFSET ?`,
      )
      .all(...[match, ...(bookFilter ? bookIds : []), limit, offset]) as typeof rows
  } catch (err) {
    // MATCH syntax error after escaping (e.g. tokenizer-specific corner case).
    throw new AppError(
      'VALIDATION',
      `检索词包含非法字符或语法错误：${(err as Error).message}`,
    )
  }

  // total via the same MATCH (without LIMIT) for pagination metadata.
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM fts_paragraphs
       JOIN paragraphs p ON p.rowid = fts_paragraphs.rowid
       JOIN chapters c ON c.id = p.chapter_id
       WHERE fts_paragraphs MATCH ?
         AND p.deleted_at IS NULL
         AND p.is_noise = 0
         ${bookFilter ? 'AND c.book_id IN (' + placeholders(bookIds) + ')' : ''}`,
    )
    .get(...[match, ...(bookFilter ? bookIds : [])]) as { n: number }

  return { total: totalRow.n, hits: rows as SearchHit[], degraded: false }
}

/** Build a ?,?,? placeholder string of length n. */
function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',')
}

/**
 * Build a <mark>-wrapped snippet for the LIKE downgrade path. Pure (no DB):
 * given the full paragraph text and the (short) query, center a window on the
 * first match, escape nothing (snippet() doesn't either for body text), wrap
 * the matched substring in <mark>, and emit the FTS5-style ellipsis (' … ')
 * when the window is truncated. Exported for unit testing.
 *
 * Window width is ~32 code points to roughly match FTS5 snippet(..., 24 tokens)
 * visual density for short CJK terms.
 */
export function makeLikeSnippet(text: string, term: string, window = 32): string {
  const cps = Array.from(text)
  const termCps = Array.from(term)
  if (cps.length === 0 || termCps.length === 0) return ''

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
  if (start === -1) return cps.slice(0, window).join('')

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
  return `${prefix}${before}<mark>${match}</mark>${after}${suffix}`
}

/**
 * Full-library highlight scan (SRH-05). Returns per-paragraph match counts for
 * the given term. Uses a LIKE scan (works for any length, including the short
 * terms trigram can't match). Scoped to a single book when scope.bookId is set
 * (default) to bound cost; omit scope for a whole-library scan.
 */
export function highlightAll(
  term: string,
  scope: { bookId?: string } = {},
): { total: number; locations: HighlightLoc[] } {
  const t = (term ?? '').trim()
  if (t === '') return { total: 0, locations: [] }

  const db = getDb()
  const like = `%${t}%`
  const scoped = typeof scope.bookId === 'string' && scope.bookId.length > 0

  const rows = db
    .prepare(
      `SELECT p.id          AS paragraphId,
              p.chapter_id  AS chapterId,
              c.book_id     AS bookId,
              (LENGTH(p.text) - LENGTH(REPLACE(p.text, ?, '')))
                / LENGTH(?) AS count
       FROM paragraphs p
       JOIN chapters c ON c.id = p.chapter_id
       WHERE p.deleted_at IS NULL
         AND p.is_noise = 0
         AND p.text LIKE ?
         ${scoped ? 'AND c.book_id = ?' : ''}`,
    )
    .all(...[t, t, like, ...(scoped ? [scope.bookId as string] : [])]) as HighlightLoc[]

  const total = rows.reduce((sum, r) => sum + r.count, 0)
  return { total, locations: rows }
}

// ---------- terminology dictionary (S3.3) ----------

const TERM_COLS = `
  term_id      AS termId,
  term         AS term,
  definition   AS definition,
  source       AS source,
  category     AS category,
  attributes   AS attributes,
  created_by   AS createdBy,
  paragraph_id AS paragraphId,
  created_at   AS createdAt,
  updated_at   AS updatedAt`

function rowToTerm(r: unknown): Term {
  return r as Term
}

/** List terms, optionally filtered by free-text (term LIKE) and category. */
export function listTerms(opts: { q?: string; category?: string } = {}): Term[] {
  const db = getDb()
  const q = opts.q?.trim()
  const cat = opts.category?.trim()
  const rows = db
    .prepare(
      `SELECT ${TERM_COLS}
       FROM dictionary_terms
       WHERE 1=1
         ${q ? 'AND term LIKE ?' : ''}
         ${cat ? 'AND category = ?' : ''}
       ORDER BY term`,
    )
    .all(...[...(q ? [`%${q}%`] : []), ...(cat ? [cat] : [])]) as Term[]
  return rows.map(rowToTerm)
}

/** Fetch one term with its occurrence list (paragraphs where it appears). */
export function getTerm(termId: string): TermDetail | null {
  const db = getDb()
  const term = db
    .prepare(`SELECT ${TERM_COLS} FROM dictionary_terms WHERE term_id = ?`)
    .get(termId) as Term | undefined
  if (!term) return null

  const occurrences = db
    .prepare(
      `SELECT o.paragraph_id AS paragraphId,
              p.chapter_id  AS chapterId,
              c.book_id     AS bookId,
              b.title       AS bookTitle,
              c.title       AS chapterTitle,
              o.count       AS count
       FROM term_occurrences o
       JOIN paragraphs p ON p.id = o.paragraph_id
       JOIN chapters    c ON c.id = p.chapter_id
       JOIN books       b ON b.id = c.book_id
       WHERE o.term_id = ?
       ORDER BY c.book_id, p.chapter_id`,
    )
    .all(termId) as TermOccurrence[]

  return { ...term, occurrences }
}

/**
 * Insert or update a term. term is UNIQUE; on conflict the existing row is
 * updated in place (merge) and its term_id is returned. id/timestamps are
 * server-assigned and never taken from the input.
 */
export function upsertTerm(input: TermInput): Term {
  const db = getDb()
  const term = input.term.trim()
  if (term === '') {
    throw new AppError('VALIDATION', '术语不能为空')
  }
  const now = Date.now()
  const termId = randomUUID()

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO dictionary_terms
         (term_id, term, definition, source, category, attributes, created_by, paragraph_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(term) DO UPDATE SET
         definition   = excluded.definition,
         source       = excluded.source,
         category     = excluded.category,
         attributes   = excluded.attributes,
         created_by   = excluded.created_by,
         paragraph_id = excluded.paragraph_id,
         updated_at   = excluded.updated_at`,
    ).run(
      termId,
      term,
      input.definition ?? null,
      input.source ?? null,
      input.category ?? null,
      input.attributes ?? null,
      input.createdBy ?? 'user',
      input.paragraphId ?? null,
      now,
      now,
    )
  })
  tx()

  // ON CONFLICT updates the existing row, so the returned id is whichever row
  // actually holds this term now.
  const row = db
    .prepare(`SELECT ${TERM_COLS} FROM dictionary_terms WHERE term = ?`)
    .get(term) as Term
  return rowToTerm(row)
}

/** Delete a term; term_occurrences cascade-clears via ON DELETE CASCADE. */
export function deleteTerm(termId: string): void {
  const db = getDb()
  const res = db.prepare('DELETE FROM dictionary_terms WHERE term_id = ?').run(termId)
  if (res.changes === 0) {
    throw new AppError('NOT_FOUND', `术语 ${termId} 不存在`)
  }
}
