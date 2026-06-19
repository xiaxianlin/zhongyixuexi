/**
 * Reading data service for the current library detail UI.
 *
 * The old standalone reading workbench is gone; this service now only returns
 * chapter paragraphs with the active paragraph analysis joined in.
 */

import { getDb } from '../db'
import { AppError } from '../lib/error'
import {
  activeAnalysisSql,
  mapParagraphAnalysisView,
  toParagraphInterpretationView,
  type ParagraphAnalysisSqlRow,
  type ParagraphInterpretationView,
} from './paragraph-analysis'

export interface ParagraphDTO {
  id: string
  chapter_id: string
  order_index: number
  text: string
  interpretation: ParagraphInterpretationView
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

/**
 * Reading-progress write payload (RD-02). One row per book (PRIMARY KEY book_id);
 * repeated saves UPSERT and ACCUMULATE read_seconds. scroll_ratio / chapter_id /
 * paragraph_id / percent are overwritten with the latest values.
 *
 * read_seconds is an increment (delta), not an absolute — the renderer debounces
 * and flushes the seconds spent on a paragraph. The UPSERT adds it onto whatever
 * was previously stored so the dashboard's SUM reflects total time across all
 * books and the heatmap gains a reading footprint.
 */
export interface SaveProgressInput {
  bookId: string
  chapterId: string
  paragraphId: string
  scrollRatio: number
  readSeconds: number
  percent: number
}

type ParagraphRow = Omit<ParagraphDTO, 'interpretation'> & ParagraphAnalysisSqlRow

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

  return {
    chapter,
    paragraphs: rows.map((paragraph) => ({
      id: paragraph.id,
      chapter_id: paragraph.chapter_id,
      order_index: paragraph.order_index,
      text: paragraph.text,
      edited: paragraph.edited,
      is_noise: paragraph.is_noise,
      interpretation: toParagraphInterpretationView(mapParagraphAnalysisView(paragraph)),
    })),
  }
}

/**
 * Persist reading progress for a book (RD-02). One row per book (PRIMARY KEY
 * book_id); UPSERT overwrites the position fields and ACCUMULATES read_seconds
 * (it is a delta, so SUM(read_seconds) across saves = total time on the book).
 *
 * read_seconds accumulation uses COALESCE((SELECT ...), 0) + ? rather than
 * excluded.read_seconds + ? because the UPSERT's `excluded` row IS the new row
 * (the delta), not the stored total — we want stored + delta.
 */
export function saveProgress(input: SaveProgressInput): { ok: true } {
  if (!input.bookId || !input.chapterId || !input.paragraphId) {
    throw new AppError('VALIDATION', 'saveProgress 缺少 bookId/chapterId/paragraphId')
  }
  const now = Date.now()
  const db = getDb()
  db.prepare(
    `INSERT INTO reading_progress
       (book_id, chapter_id, paragraph_id, scroll_ratio, read_seconds, percent, updated_at)
     VALUES (@bookId, @chapterId, @paragraphId, @scrollRatio, @readSeconds, @percent, @now)
     ON CONFLICT(book_id) DO UPDATE SET
       chapter_id   = excluded.chapter_id,
       paragraph_id = excluded.paragraph_id,
       scroll_ratio = excluded.scroll_ratio,
       read_seconds = COALESCE((SELECT read_seconds FROM reading_progress WHERE book_id = @bookId), 0) + @readSeconds,
       percent      = excluded.percent,
       updated_at   = @now`,
  ).run({
    bookId: input.bookId,
    chapterId: input.chapterId,
    paragraphId: input.paragraphId,
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
