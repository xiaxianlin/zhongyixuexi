/**
 * Reading data service for the v3.1 chapter-level detail UI.
 *
 * The reading atom is a CHAPTER: getChapterContent returns the whole-chapter
 * plain text + the active chapter-level analysis. There is no paragraph loader
 * (paragraphs are not persisted as rows; selection excerpts anchor against
 * chapters.content by offset).
 */
import { getDb } from '../db'
import { AppError } from '../lib/error'
import {
  activeChapterAnalysisSql,
  mapActiveChapterAnalysis,
  type ActiveChapterAnalysis,
} from './chapter-analysis'

export interface ChapterDTO {
  id: string
  book_id: string
  parent_id: string | null
  order_index: number
  level: string | null
  title: string
}

export interface ChapterAnalysisMeta {
  id: string
  kind: string
  version: number
  source: string
  model: string | null
  created_at: number
  updated_at: number
}

export interface ChapterAnalysisView {
  modern: string | null
  explanation: string | null
  analysis: string | null
  summary: string | null
  meta: ChapterAnalysisMeta | null
}

/** Whole-chapter reading-pane payload: chapter meta + plain text + analysis. */
export interface ChapterContentView {
  chapter: ChapterDTO
  content: string
  analysis: ActiveChapterAnalysis
}

/**
 * Reading-progress write payload. One row per book (PRIMARY KEY book_id);
 * repeated saves UPSERT and ACCUMULATE read_seconds. scroll_ratio / chapter_id
 * / percent are overwritten with the latest values.
 *
 * read_seconds is an increment (delta), not an absolute — the renderer debounces
 * and flushes the seconds spent reading. The UPSERT adds it onto whatever was
 * previously stored so the dashboard's SUM reflects total time.
 */
export interface SaveProgressInput {
  bookId: string
  chapterId: string
  scrollRatio: number
  readSeconds: number
  percent: number
}

interface ChapterContentRow extends ChapterDTO {
  content: string | null
  modern: string | null
  explanation: string | null
  analysis: string | null
  summary: string | null
  analysis_id: string | null
  analysis_kind: string | null
  analysis_version: number | null
  analysis_source: string | null
  analysis_model: string | null
  analysis_created_at: number | null
  analysis_updated_at: number | null
}

/**
 * Load a chapter for the reading pane: whole-chapter plain text + the active
 * chapter-level analysis (null when none has been generated yet).
 */
export function getChapterContent(
  bookId: string,
  chapterId: string,
): ChapterContentView | null {
  const db = getDb()
  const a = activeChapterAnalysisSql()
  const row = db
    .prepare(
      `SELECT c.id, c.book_id, c.parent_id, c.order_index, c.level, c.title, c.content,
              ${a.columns}
         FROM chapters c
         ${a.join}
        WHERE c.id = ? AND c.book_id = ? AND c.deleted_at IS NULL`,
    )
    .get(chapterId, bookId) as ChapterContentRow | undefined

  if (!row) return null

  return {
    chapter: {
      id: row.id,
      book_id: row.book_id,
      parent_id: row.parent_id,
      order_index: row.order_index,
      level: row.level,
      title: row.title,
    },
    content: row.content ?? '',
    analysis: mapActiveChapterAnalysis(row),
  }
}

/**
 * Persist reading progress for a book. One row per book (PRIMARY KEY book_id);
 * UPSERT overwrites the position fields and ACCUMULATES read_seconds (it is a
 * delta, so SUM(read_seconds) across saves = total time on the book).
 */
export function saveProgress(input: SaveProgressInput): { ok: true } {
  if (!input.bookId || !input.chapterId) {
    throw new AppError('VALIDATION', 'saveProgress 缺少 bookId/chapterId')
  }
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `INSERT INTO reading_progress
       (book_id, chapter_id, scroll_ratio, read_seconds, percent, updated_at)
     VALUES (@bookId, @chapterId, @scrollRatio, @readSeconds, @percent, @now)
     ON CONFLICT(book_id) DO UPDATE SET
       chapter_id   = excluded.chapter_id,
       scroll_ratio = excluded.scroll_ratio,
       read_seconds = COALESCE((SELECT read_seconds FROM reading_progress WHERE book_id = @bookId), 0) + @readSeconds,
       percent      = excluded.percent,
       updated_at   = @now`,
  ).run({
    bookId: input.bookId,
    chapterId: input.chapterId,
    scrollRatio: clamp01(input.scrollRatio),
    readSeconds: Math.max(0, Math.floor(input.readSeconds)),
    percent: clamp01(input.percent),
    now,
  })
  return { ok: true }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
