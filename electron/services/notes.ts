import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'

export interface CreateNoteInput {
  content?: string
  book_id?: string | null
  chapter_id?: string | null
  paragraph_id?: string | null
}

export interface ParagraphNoteCard {
  id: string
  content: string
  created_at: number
  updated_at: number
}

function resolveParagraphContext(
  paragraphId: string,
): { chapter_id: string | null; book_id: string | null } {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT p.chapter_id, c.book_id
       FROM paragraphs p
       JOIN chapters c ON c.id = p.chapter_id
       WHERE p.id = ? AND p.deleted_at IS NULL AND c.deleted_at IS NULL`,
    )
    .get(paragraphId) as { chapter_id: string; book_id: string } | undefined
  if (!row) throw new AppError('NOT_FOUND', `段落 ${paragraphId} 不存在`)
  return row
}

export function createNote(input: CreateNoteInput): ParagraphNoteCard {
  const paragraphId = input.paragraph_id ?? null
  if (!paragraphId) throw new AppError('VALIDATION', '笔记必须绑定段落')

  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  const content = input.content?.trim() ?? ''
  const paragraphContext = resolveParagraphContext(paragraphId)

  db.prepare(
    `INSERT INTO notes (id, content, book_id, chapter_id, paragraph_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    content,
    input.book_id ?? paragraphContext.book_id,
    input.chapter_id ?? paragraphContext.chapter_id,
    paragraphId,
    now,
    now,
  )

  return { id, content, created_at: now, updated_at: now }
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

export function getNotesByParagraph(paragraphId: string): ParagraphNoteCard[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, content, created_at, updated_at
       FROM notes
       WHERE paragraph_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC`,
    )
    .all(paragraphId) as ParagraphNoteCard[]
  return rows
}
