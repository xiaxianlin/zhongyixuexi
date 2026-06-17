/**
 * Learning dashboard aggregation.
 *
 * The current product no longer has review cards or quizzes. "Learning" is the
 * user's real reading/study footprint: built-in classics, paragraphs read,
 * analyses generated, and notes written.
 */

import { getDb } from '../db/connection'

export interface DashboardDTO {
  totalBooks: number
  totalChapters: number
  totalParagraphs: number
  analyzedParagraphs: number
  analysisRate: number
  noteCount: number
  activeReadingBooks: number
  totalReadSeconds: number
  heatmap: Record<string, number>
  recentBooks: {
    book_id: string
    title: string
    percent: number
    updated_at: number
  }[]
}

function count(sql: string, ...params: unknown[]): number {
  const row = getDb().prepare(sql).get(...params) as { cnt: number } | undefined
  return row?.cnt ?? 0
}

function yearRange(year: number): { start: number; end: number } {
  return {
    start: new Date(year, 0, 1).getTime(),
    end: new Date(year + 1, 0, 1).getTime(),
  }
}

export function getDashboard(): DashboardDTO {
  const db = getDb()
  const totalBooks = count(`SELECT COUNT(*) AS cnt FROM books WHERE deleted_at IS NULL`)
  const totalChapters = count(
    `SELECT COUNT(*) AS cnt
     FROM chapters ch
     JOIN books b ON b.id = ch.book_id
     WHERE ch.deleted_at IS NULL AND b.deleted_at IS NULL`,
  )
  const totalParagraphs = count(
    `SELECT COUNT(*) AS cnt
     FROM paragraphs p
     JOIN chapters ch ON ch.id = p.chapter_id
     JOIN books b ON b.id = ch.book_id
     WHERE p.deleted_at IS NULL AND p.is_noise = 0 AND ch.deleted_at IS NULL AND b.deleted_at IS NULL`,
  )
  const analyzedParagraphs = count(
    `SELECT COUNT(DISTINCT pa.paragraph_id) AS cnt
     FROM paragraph_analyses pa
     JOIN paragraphs p ON p.id = pa.paragraph_id
     JOIN chapters ch ON ch.id = p.chapter_id
     JOIN books b ON b.id = ch.book_id
     WHERE pa.is_active = 1
       AND p.deleted_at IS NULL
       AND p.is_noise = 0
       AND ch.deleted_at IS NULL
       AND b.deleted_at IS NULL`,
  )
  const noteCount = count(`SELECT COUNT(*) AS cnt FROM notes WHERE deleted_at IS NULL`)
  const progress = db
    .prepare(
      `SELECT COUNT(*) AS activeReadingBooks,
              COALESCE(SUM(read_seconds), 0) AS totalReadSeconds
       FROM reading_progress`,
    )
    .get() as { activeReadingBooks: number; totalReadSeconds: number } | undefined

  const recentBooks = db
    .prepare(
      `SELECT rp.book_id, b.title, rp.percent, rp.updated_at
       FROM reading_progress rp
       JOIN books b ON b.id = rp.book_id
       WHERE b.deleted_at IS NULL
       ORDER BY rp.updated_at DESC
       LIMIT 6`,
    )
    .all() as DashboardDTO['recentBooks']

  return {
    totalBooks,
    totalChapters,
    totalParagraphs,
    analyzedParagraphs,
    analysisRate: totalParagraphs === 0 ? 0 : analyzedParagraphs / totalParagraphs,
    noteCount,
    activeReadingBooks: progress?.activeReadingBooks ?? 0,
    totalReadSeconds: progress?.totalReadSeconds ?? 0,
    heatmap: getHeatmap(new Date().getFullYear()),
    recentBooks,
  }
}

function getHeatmap(year: number): Record<string, number> {
  const db = getDb()
  const { start, end } = yearRange(year)
  const rows = db
    .prepare(
      `SELECT day, SUM(cnt) AS cnt
       FROM (
         SELECT date(updated_at / 1000, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS cnt
         FROM reading_progress
         WHERE updated_at >= ? AND updated_at < ?
         GROUP BY day
         UNION ALL
         SELECT date(updated_at / 1000, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS cnt
         FROM notes
         WHERE deleted_at IS NULL AND updated_at >= ? AND updated_at < ?
         GROUP BY day
         UNION ALL
         SELECT date(updated_at / 1000, 'unixepoch', 'localtime') AS day,
                COUNT(*) AS cnt
         FROM paragraph_analyses
         WHERE is_active = 1 AND updated_at >= ? AND updated_at < ?
         GROUP BY day
       )
       GROUP BY day`,
    )
    .all(start, end, start, end, start, end) as { day: string; cnt: number }[]

  return Object.fromEntries(rows.map((row) => [row.day, row.cnt]))
}
