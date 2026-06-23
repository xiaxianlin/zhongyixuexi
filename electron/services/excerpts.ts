/**
 * Excerpts service (v3.1 detail revamp, EXC module).
 *
 * Selection-anchored highlights stored against chapters.content (UTF-16 offsets).
 * Pure-local: no AI, no Key required. When a chapter's content is edited, the
 * editing service calls `reanchorExcerpts` to update surviving offsets and flag
 * the rest `stale=1` (the excerpt_text snapshot is preserved so the card can
 * still show what was originally selected).
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { reanchorRange } from './excerpt-anchor'

export interface ExcerptDTO {
  id: string
  book_id: string
  chapter_id: string
  start_offset: number
  end_offset: number
  excerpt_text: string
  note: string | null
  stale: number
  created_at: number
  updated_at: number
}

interface ExcerptRow extends Omit<ExcerptDTO, 'stale'> {
  stale: number
}

function resolveChapterContext(
  chapterId: string,
): { book_id: string; content: string } {
  const db = getDb()
  const row = db
    .prepare('SELECT book_id, content FROM chapters WHERE id = ? AND deleted_at IS NULL')
    .get(chapterId) as { book_id: string; content: string | null } | undefined
  if (!row) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
  return { book_id: row.book_id, content: row.content ?? '' }
}

function validateRange(content: string, start: number, end: number, text: string): void {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new AppError('VALIDATION', '选区偏移必须为整数')
  }
  if (start < 0 || end <= start) {
    throw new AppError('VALIDATION', '选区范围非法')
  }
  if (end > content.length) {
    throw new AppError('VALIDATION', '选区超出正文长度')
  }
  if (content.slice(start, end) !== text) {
    throw new AppError('VALIDATION', '选区文本与正文不一致')
  }
}

export function createExcerpt(input: {
  bookId?: string
  chapterId: string
  start: number
  end: number
  text: string
  note?: string | null
}): ExcerptDTO {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  return db.transaction(() => {
    const ctx = resolveChapterContext(input.chapterId)
    const bookId = input.bookId ?? ctx.book_id
    const text = input.text
    validateRange(ctx.content, input.start, input.end, text)
    db.prepare(
      `INSERT INTO excerpts
         (id, book_id, chapter_id, start_offset, end_offset, excerpt_text, note, stale, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id,
      bookId,
      input.chapterId,
      input.start,
      input.end,
      text,
      input.note ?? null,
      now,
      now,
    )
    return getExcerpt(id)!
  })()
}

export function getExcerpt(id: string): ExcerptDTO | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, book_id, chapter_id, start_offset, end_offset, excerpt_text, note, stale, created_at, updated_at
         FROM excerpts WHERE id = ?`,
    )
    .get(id) as ExcerptRow | undefined
  return row ? toDTO(row) : null
}

export function listExcerptsByChapter(chapterId: string): ExcerptDTO[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, book_id, chapter_id, start_offset, end_offset, excerpt_text, note, stale, created_at, updated_at
         FROM excerpts
        WHERE chapter_id = ?
        ORDER BY start_offset, created_at`,
    )
    .all(chapterId) as ExcerptRow[]
  return rows.map(toDTO)
}

export function listExcerptsByBook(bookId: string): ExcerptDTO[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, book_id, chapter_id, start_offset, end_offset, excerpt_text, note, stale, created_at, updated_at
         FROM excerpts
        WHERE book_id = ?
        ORDER BY created_at DESC`,
    )
    .all(bookId) as ExcerptRow[]
  return rows.map(toDTO)
}

export function deleteExcerpt(id: string): { ok: true } {
  const db = getDb()
  const result = db.prepare('DELETE FROM excerpts WHERE id = ?').run(id)
  if (result.changes === 0) throw new AppError('NOT_FOUND', `摘录 ${id} 不存在`)
  return { ok: true }
}

/**
 * Re-anchor every excerpt of a chapter after its content changed.
 * Called by editing.saveChapterContent inside its transaction. Returns counts
 * for logging/telemetry; the DB rows are updated in place.
 */
export function reanchorExcerpts(
  chapterId: string,
  oldText: string,
  newText: string,
): { updated: number; stale: number; untouched: number } {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, start_offset, end_offset, excerpt_text, stale
         FROM excerpts WHERE chapter_id = ?`,
    )
    .all(chapterId) as {
    id: string
    start_offset: number
    end_offset: number
    excerpt_text: string
    stale: number
  }[]
  if (rows.length === 0) return { updated: 0, stale: 0, untouched: 0 }

  const upd = db.prepare(
    `UPDATE excerpts SET start_offset = ?, end_offset = ?, stale = ?, updated_at = ? WHERE id = ?`,
  )
  let updated = 0
  let stale = 0
  let untouched = 0
  for (const ex of rows) {
    const res = reanchorRange({
      oldText,
      newText,
      start: ex.start_offset,
      end: ex.end_offset,
      excerptText: ex.excerpt_text,
    })
    if (res.stale === 1) stale++
    else if (
      res.start !== ex.start_offset ||
      res.end !== ex.end_offset ||
      ex.stale === 1
    ) {
      updated++
    } else {
      untouched++
    }
    upd.run(res.start, res.end, res.stale, Date.now(), ex.id)
  }
  return { updated, stale, untouched }
}

function toDTO(row: ExcerptRow): ExcerptDTO {
  return {
    id: row.id,
    book_id: row.book_id,
    chapter_id: row.chapter_id,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    excerpt_text: row.excerpt_text,
    note: row.note,
    stale: row.stale,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
