/**
 * Reading service (RD module).
 *
 * Segment-level progress, bookmarks, chapter content fetch, and term lookup.
 * All queries go through the better-sqlite3 singleton from getDb(); the
 * connection initializer enforces PRAGMA foreign_keys=ON (00-arch §5.1) so the
 * ON DELETE CASCADE / SET NULL declared in migrations/reading.sql actually fires.
 *
 * Stable IDs (00-arch §5.5): progress/bookmarks reference paragraphs.id and
 * chapters.id (TEXT stable UUIDs). bookmarks.paragraph_id is ON DELETE SET NULL
 * so a segment-edit hard delete degrades the bookmark to chapter-level rather
 * than losing it.
 *
 * Schema note: the real schema uses `id` as the stable TEXT primary key on
 * books/chapters/paragraphs (NOT book_id/chapter_id). AI interpretations are
 * read from the active paragraph_analyses row.
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { AppError } from '../lib/error'
import {
  activateParagraphAnalysis,
  activeAnalysisSql,
  getActiveParagraphAnalysisView,
  listParagraphAnalysisHistory,
  mapParagraphAnalysisView,
  toParagraphInterpretationDTO,
  toParagraphInterpretationView,
  type ParagraphAnalysisHistoryItem,
  type ParagraphAnalysisSqlRow,
  type ParagraphInterpretationDTO,
  type ParagraphInterpretationView,
} from './paragraph-analysis'

// ---------- DTOs (self-contained; do NOT import models/content.ts) ----------

export interface ParagraphDTO {
  id: string
  chapter_id: string
  order_index: number
  text: string
  interpretation: InterpretationViewDTO
  edited: number
  is_noise: number
}

export interface ChapterDTO {
  id: string
  book_id: string
  parent_id: string | null
  order_index: number
  level: string | null
  title: string
}

export interface ChapterContent {
  chapter: ChapterDTO
  paragraphs: ParagraphDTO[]
}

export interface ProgressDTO {
  book_id: string
  chapter_id: string
  paragraph_id: string
  scroll_ratio: number
  read_seconds: number
  percent: number
  updated_at: number
}

/** Input shape for saveProgress (renderer→main); server adds updated_at. */
export interface SaveProgressInput {
  book_id: string
  chapter_id: string
  paragraph_id: string
  scroll_ratio: number
  read_seconds?: number
  percent?: number
}

export interface BookmarkDTO {
  id: string
  book_id: string
  chapter_id: string
  paragraph_id: string | null
  title: string | null
  note: string | null
  color: string | null
  created_at: number
  updated_at: number
}

export interface AddBookmarkInput {
  book_id: string
  chapter_id: string
  paragraph_id?: string | null
  title?: string | null
  note?: string | null
  color?: string | null
}

export interface UpdateBookmarkInput {
  id: string
  title?: string | null
  note?: string | null
  color?: string | null
}

export type InterpretationDTO = ParagraphInterpretationDTO

export type InterpretationViewDTO = ParagraphInterpretationView

export type ParagraphAnalysisHistoryDTO = ParagraphAnalysisHistoryItem

type ParagraphRow = Omit<ParagraphDTO, 'interpretation'> & ParagraphAnalysisSqlRow

export interface TermLookupDTO {
  term: string
  definition: string | null
  category: string | null
  source: string | null
  found: boolean
}

// ---------- chapter content ----------

/**
 * Fetches a chapter and its live paragraphs ordered by order_index.
 * Null when the chapter does not exist. Paragraphs are always live
 * (deleted_at IS NULL). Performance target NFR-P2: ≤200ms for local hit.
 */
export function getChapter(bookId: string, chapterId: string): ChapterContent | null {
  const db = getDb()
  const chapter = db
    .prepare(
      `SELECT id, book_id, parent_id, order_index, level, title
       FROM chapters
       WHERE id = ? AND book_id = ? AND deleted_at IS NULL`,
    )
    .get(chapterId, bookId) as ChapterDTO | undefined
  if (!chapter) return null

  const activeAnalysis = activeAnalysisSql()
  const rows = db
    .prepare(
      `SELECT p.id,
              p.chapter_id,
              p.order_index,
              p.text,
              ${activeAnalysis.columns},
              p.edited,
              p.is_noise
       FROM paragraphs p
       ${activeAnalysis.join}
       WHERE p.chapter_id = ? AND p.deleted_at IS NULL
       ORDER BY p.order_index`,
    )
    .all(chapterId) as ParagraphRow[]
  const paragraphs = rows.map((paragraph) => {
    const analysisView = mapParagraphAnalysisView(paragraph)
    return {
      id: paragraph.id,
      chapter_id: paragraph.chapter_id,
      order_index: paragraph.order_index,
      text: paragraph.text,
      edited: paragraph.edited,
      is_noise: paragraph.is_noise,
      interpretation: toParagraphInterpretationView(analysisView),
    }
  })

  return { chapter, paragraphs }
}

// ---------- progress (RD-08) ----------

/** Returns the saved reading progress for a book, or null if none yet. */
export function getProgress(bookId: string): ProgressDTO | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT book_id, chapter_id, paragraph_id, scroll_ratio, read_seconds, percent, updated_at
       FROM reading_progress
       WHERE book_id = ?`,
    )
    .get(bookId) as ProgressDTO | undefined
  return row ?? null
}

/**
 * UPSERT reading_progress inside a transaction (crash-safe, 03-reading.md §7.3).
 * Validates that chapter_id / paragraph_id belong to the book before writing.
 * Returns the freshly written row.
 */
export function saveProgress(input: SaveProgressInput): ProgressDTO {
  const db = getDb()
  const { book_id, chapter_id, paragraph_id } = input
  const scroll_ratio = clamp(input.scroll_ratio ?? 0, 0, 1)
  const read_seconds = Math.max(0, Math.floor(input.read_seconds ?? 0))
  const percent = clamp(input.percent ?? 0, 0, 1)

  // Validate ownership: chapter belongs to book, paragraph belongs to chapter.
  const chapter = db
    .prepare('SELECT 1 FROM chapters WHERE id = ? AND book_id = ? AND deleted_at IS NULL')
    .get(chapter_id, book_id)
  if (!chapter) {
    throw new AppError('VALIDATION', `chapter ${chapter_id} does not belong to book ${book_id}`)
  }
  const paragraph = db
    .prepare('SELECT 1 FROM paragraphs WHERE id = ? AND chapter_id = ? AND deleted_at IS NULL')
    .get(paragraph_id, chapter_id)
  if (!paragraph) {
    throw new AppError(
      'VALIDATION',
      `paragraph ${paragraph_id} does not belong to chapter ${chapter_id}`,
    )
  }

  const now = Date.now()
  const upsert = db.prepare(
    `INSERT INTO reading_progress (book_id, chapter_id, paragraph_id, scroll_ratio, read_seconds, percent, updated_at)
     VALUES (@book_id, @chapter_id, @paragraph_id, @scroll_ratio, @read_seconds, @percent, @updated_at)
     ON CONFLICT(book_id) DO UPDATE SET
       chapter_id   = excluded.chapter_id,
       paragraph_id = excluded.paragraph_id,
       scroll_ratio = excluded.scroll_ratio,
       read_seconds = excluded.read_seconds,
       percent      = excluded.percent,
       updated_at   = excluded.updated_at`,
  )
  db.transaction(() => {
    upsert.run({
      book_id,
      chapter_id,
      paragraph_id,
      scroll_ratio,
      read_seconds,
      percent,
      updated_at: now,
    })
  })()

  return {
    book_id,
    chapter_id,
    paragraph_id,
    scroll_ratio,
    read_seconds,
    percent,
    updated_at: now,
  }
}

// ---------- bookmarks (RD-08) ----------

/** Lists bookmarks for a book, newest-first. */
export function listBookmarks(bookId: string): BookmarkDTO[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT id, book_id, chapter_id, paragraph_id, title, note, color, created_at, updated_at
       FROM bookmarks
       WHERE book_id = ?
       ORDER BY created_at DESC`,
    )
    .all(bookId) as BookmarkDTO[]
}

/**
 * Adds a bookmark. Defaults the title to the paragraph's leading text (first 16
 * chars) or the chapter title when omitted. Validates chapter/paragraph
 * ownership. Returns the new row.
 */
export function addBookmark(input: AddBookmarkInput): BookmarkDTO {
  const db = getDb()
  const { book_id, chapter_id, paragraph_id } = input

  const chapter = db
    .prepare('SELECT 1 FROM chapters WHERE id = ? AND book_id = ? AND deleted_at IS NULL')
    .get(chapter_id, book_id)
  if (!chapter) {
    throw new AppError('VALIDATION', `chapter ${chapter_id} does not belong to book ${book_id}`)
  }
  if (paragraph_id) {
    const paragraph = db
      .prepare('SELECT 1 FROM paragraphs WHERE id = ? AND chapter_id = ? AND deleted_at IS NULL')
      .get(paragraph_id, chapter_id)
    if (!paragraph) {
      throw new AppError(
        'VALIDATION',
        `paragraph ${paragraph_id} does not belong to chapter ${chapter_id}`,
      )
    }
  }

  let title = input.title ?? null
  if (title == null) {
    if (paragraph_id) {
      const p = db
        .prepare('SELECT text FROM paragraphs WHERE id = ?')
        .get(paragraph_id) as { text: string } | undefined
      title = p ? p.text.slice(0, 16) : null
    } else {
      const c = db
        .prepare('SELECT title FROM chapters WHERE id = ?')
        .get(chapter_id) as { title: string } | undefined
      title = c ? c.title : null
    }
  }

  const id = randomUUID()
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO bookmarks (id, book_id, chapter_id, paragraph_id, title, note, color, created_at, updated_at)
     VALUES (@id, @book_id, @chapter_id, @paragraph_id, @title, @note, @color, @created_at, @updated_at)`,
  )
  db.transaction(() => {
    insert.run({
      id,
      book_id,
      chapter_id,
      paragraph_id: paragraph_id ?? null,
      title,
      note: input.note ?? null,
      color: input.color ?? null,
      created_at: now,
      updated_at: now,
    })
  })()

  return {
    id,
    book_id,
    chapter_id,
    paragraph_id: paragraph_id ?? null,
    title,
    note: input.note ?? null,
    color: input.color ?? null,
    created_at: now,
    updated_at: now,
  }
}

/** Updates editable bookmark fields. Returns the updated row or throws NOT_FOUND. */
export function updateBookmark(input: UpdateBookmarkInput): BookmarkDTO {
  const db = getDb()
  const { id } = input
  const existing = db
    .prepare(
      'SELECT id, book_id, chapter_id, paragraph_id, title, note, color, created_at, updated_at FROM bookmarks WHERE id = ?',
    )
    .get(id) as BookmarkDTO | undefined
  if (!existing) {
    throw new AppError('NOT_FOUND', `bookmark ${id} not found`)
  }
  const now = Date.now()
  db.prepare(
    `UPDATE bookmarks
     SET title = @title, note = @note, color = @color, updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id,
    title: input.title ?? existing.title,
    note: input.note ?? existing.note,
    color: input.color ?? existing.color,
    updated_at: now,
  })
  return { ...existing, title: input.title ?? existing.title, note: input.note ?? existing.note, color: input.color ?? existing.color, updated_at: now }
}

/** Removes a bookmark by id. No-op (returns ok:false) if it no longer exists. */
export function removeBookmark(id: string): { ok: boolean } {
  const db = getDb()
  const res = db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id)
  return { ok: res.changes > 0 }
}

// ---------- interpretation (RD-03, reads active analysis view) ----------

/**
 * Returns the active AI interpretation view for a paragraph. cached=false when
 * all content fields are null, so the renderer can show a generate placeholder.
 * RD never calls the AI itself (03-reading.md §7.2).
 */
export function getInterpretation(paragraphId: string): InterpretationDTO {
  const view = getActiveParagraphAnalysisView(paragraphId)
  if (!view) {
    throw new AppError('NOT_FOUND', `paragraph ${paragraphId} not found`)
  }
  return toParagraphInterpretationDTO(view)
}

export function listInterpretationHistory(paragraphId: string): ParagraphAnalysisHistoryDTO[] {
  assertLiveParagraph(paragraphId)
  return listParagraphAnalysisHistory(paragraphId)
}

export function activateInterpretationVersion(
  paragraphId: string,
  analysisId: string,
): InterpretationDTO {
  assertLiveParagraph(paragraphId)
  const view = activateParagraphAnalysis(paragraphId, analysisId)
  return toParagraphInterpretationDTO(view)
}

function assertLiveParagraph(paragraphId: string): void {
  const exists = getDb()
    .prepare('SELECT 1 FROM paragraphs WHERE id = ? AND deleted_at IS NULL')
    .get(paragraphId)
  if (!exists) {
    throw new AppError('NOT_FOUND', `paragraph ${paragraphId} not found`)
  }
}

// ---------- term lookup (RD-05, reads SRH dictionary_terms) ----------

/**
 * Looks up a term in the SRH dictionary_terms table (SRH-04). Returns
 * found=false when the dictionary is empty or has no match — the renderer
 * offers an "AI explain" affordance in that case. Safe against a missing
 * dictionary_terms table (SRH may not have run its migration yet): the table
 * probe degrades to not-found rather than throwing.
 */
export function lookupTerm(term: string): TermLookupDTO {
  const db = getDb()
  const clean = term.trim()
  if (clean === '') return { term: clean, definition: null, category: null, source: null, found: false }

  // Guard: dictionary_terms may not exist yet (SRH migration not applied).
  // Probe schema_master once; if absent, treat as not-found.
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dictionary_terms'")
    .get()
  if (!hasTable) {
    return { term: clean, definition: null, category: null, source: null, found: false }
  }

  const row = db
    .prepare('SELECT definition, category, source FROM dictionary_terms WHERE term = ?')
    .get(clean) as { definition: string | null; category: string | null; source: string | null } | undefined
  if (!row) {
    return { term: clean, definition: null, category: null, source: null, found: false }
  }
  return {
    term: clean,
    definition: row.definition,
    category: row.category,
    source: row.source,
    found: row.definition != null,
  }
}

// ---------- helpers ----------

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}
