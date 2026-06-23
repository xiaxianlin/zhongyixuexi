/**
 * Notes service (v3.1 chapter-level model).
 *
 * Notes bind to a chapter (+ optional selection range against chapters.content).
 * When a chapter's content is edited, editing.saveChapterContent re-anchors the
 * selection range (or flags the note stale). Deleting a chapter SET NULLs the
 * note's chapter_id so it survives as a free note.
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'

export interface CreateNoteInput {
  content?: string
  book_id?: string | null
  chapter_id?: string | null
  start_offset?: number | null
  end_offset?: number | null
  quote_text?: string | null
}

export interface NoteCard {
  id: string
  content: string
  book_id: string | null
  chapter_id: string | null
  start_offset: number | null
  end_offset: number | null
  quote_text: string | null
  stale: number
  created_at: number
  updated_at: number
}

interface NoteRow extends Omit<NoteCard, 'stale'> {
  stale: number
}

function resolveChapterContext(
  chapterId: string,
): { book_id: string } {
  const db = getDb()
  const row = db
    .prepare('SELECT book_id FROM chapters WHERE id = ? AND deleted_at IS NULL')
    .get(chapterId) as { book_id: string } | undefined
  if (!row) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
  return row
}

export function createNote(input: CreateNoteInput): NoteCard {
  const chapterId = input.chapter_id ?? null
  if (!chapterId) throw new AppError('VALIDATION', '笔记必须绑定章节')

  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  const content = input.content?.trim() ?? ''
  const ctx = resolveChapterContext(chapterId)

  db.prepare(
    `INSERT INTO notes
       (id, content, book_id, chapter_id, start_offset, end_offset, quote_text, stale,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
  ).run(
    id,
    content,
    input.book_id ?? ctx.book_id,
    chapterId,
    input.start_offset ?? null,
    input.end_offset ?? null,
    input.quote_text ?? null,
    now,
    now,
  )

  return getNote(id)!
}

export function getNote(id: string): NoteCard | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, content, book_id, chapter_id, start_offset, end_offset, quote_text, stale,
              created_at, updated_at
         FROM notes WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id) as NoteRow | undefined
  return row ? toCard(row) : null
}

export function deleteNote(id: string): { ok: true } {
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(now, now, id)
  if (result.changes === 0) {
    throw new AppError('NOT_FOUND', `笔记 ${id} 不存在或已删除`)
  }
  return { ok: true }
}

/** Notes bound to a chapter (selection-anchored first, then free notes), newest
 *  first within each group. */
export function getNotesByChapter(chapterId: string): NoteCard[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, content, book_id, chapter_id, start_offset, end_offset, quote_text, stale,
              created_at, updated_at
         FROM notes
        WHERE chapter_id = ? AND deleted_at IS NULL
        ORDER BY (start_offset IS NULL), start_offset ASC, updated_at DESC`,
    )
    .all(chapterId) as NoteRow[]
  return rows.map(toCard)
}

function toCard(row: NoteRow): NoteCard {
  return {
    id: row.id,
    content: row.content,
    book_id: row.book_id,
    chapter_id: row.chapter_id,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    quote_text: row.quote_text,
    stale: row.stale,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
