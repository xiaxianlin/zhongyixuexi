/**
 * Editing service (v3.1 chapter-level model).
 *
 * Covers book create/delete/rename/category, chapter tree CRUD (create-child,
 * rename, delete), and whole-chapter content editing. Saving chapter content
 * re-anchors excerpts + selection-bound notes whose offsets reference the old
 * text (see excerpt-anchor.ts). FTS sync is automatic via the chapters_ai/ad/au
 * triggers.
 *
 * There are no paragraph-level operations (no merge / split / paragraph text
 * edit) — the chapter is the reading + editing atom.
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { normalize } from './content-normalize'
import { sha256Hex16 } from './parse-hash'
import { getChapterContent, type ChapterContentView } from './reading'
import { reanchorExcerpts } from './excerpts'
import { reanchorRange } from './excerpt-anchor'

// ============================================================================
// Book: title / category / create / delete
// ============================================================================

/** Rename a book. Throws NOT_FOUND if the book is gone. */
export function editBookTitle(bookId: string, title: string): { id: string; title: string } {
  const t = title.trim()
  if (!t) throw new AppError('VALIDATION', '书名不能为空')
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare('UPDATE books SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(t, now, bookId)
  if (result.changes === 0) throw new AppError('NOT_FOUND', `书籍 ${bookId} 不存在`)
  return { id: bookId, title: t }
}

/** Set a book's category ('classic' | 'modern'). Throws NOT_FOUND if gone. */
export function setBookCategory(
  bookId: string,
  category: string,
): { id: string; category: string } {
  const c = category === 'classic' || category === 'modern' ? category : 'modern'
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare('UPDATE books SET category = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(c, now, bookId)
  if (result.changes === 0) throw new AppError('NOT_FOUND', `书籍 ${bookId} 不存在`)
  return { id: bookId, category: c }
}

/** Create a new (empty) book at the end of the library. New books default to
 *  'modern' (built-ins seed as 'classic' in builtin-content.ts). */
export function createBook(title: string, author?: string): { id: string; title: string } {
  const t = title.trim()
  if (!t) throw new AppError('VALIDATION', '书名不能为空')
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  db.transaction(() => {
    const maxOrder = db
      .prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM books WHERE deleted_at IS NULL')
      .get() as { m: number }
    db.prepare(
      `INSERT INTO books (id, title, author, category, order_index, updated_at)
       VALUES (?, ?, ?, 'modern', ?, ?)`,
    ).run(id, t, author?.trim() || null, maxOrder.m + 1, now)
  })()
  return { id, title: t }
}

/** Soft-delete a book and hard-delete its chapters so the FK CASCADE children
 *  (excerpts, chapter_analyses, ai_threads/ai_messages) are cleaned up. FK
 *  CASCADE only fires on a real DELETE (not on UPDATE), so soft-deleting chapters
 *  would leave orphans — we hard-delete them here. notes.chapter_id is SET NULL
 *  by FK so free notes survive. reading_progress rows are removed explicitly
 *  (their FK CASCADE fires on the chapter hard-delete, but we clear book-level
 *  rows first for clarity). The book itself is soft-deleted (recoverable). */
export function deleteBook(bookId: string): { ok: true } {
  const db = getDb()
  return db.transaction(() => {
    const exists = db
      .prepare('SELECT 1 FROM books WHERE id = ? AND deleted_at IS NULL')
      .get(bookId)
    if (!exists) throw new AppError('NOT_FOUND', `书籍 ${bookId} 不存在`)
    const now = Date.now()
    // hard-delete this book's reading_progress (FK CASCADE won't fire on book soft-delete)
    db.prepare('DELETE FROM reading_progress WHERE book_id = ?').run(bookId)
    // HARD-delete chapters → triggers FK CASCADE on excerpts / chapter_analyses /
    // ai_threads(+ai_messages); notes.chapter_id SET NULL (free notes survive).
    db.prepare('DELETE FROM chapters WHERE book_id = ?').run(bookId)
    // soft-delete the book (recoverable)
    db.prepare('UPDATE books SET deleted_at = ? WHERE id = ?').run(now, bookId)
    return { ok: true as const }
  })()
}

// ============================================================================
// Chapter tree: create / rename / delete
// ============================================================================

/** Maximum chapter nesting depth (PRD LIB-T-08). A root chapter is level 1. */
const MAX_CHAPTER_DEPTH = 3

/** Rename a chapter. Bumps chapters.updated_at. Throws NOT_FOUND if gone. */
export function editChapterTitle(chapterId: string, title: string): { id: string; title: string } {
  const t = title.trim()
  if (!t) throw new AppError('VALIDATION', '章节名不能为空')
  const db = getDb()
  const now = Date.now()
  const result = db
    .prepare('UPDATE chapters SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(t, now, chapterId)
  if (result.changes === 0) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
  return { id: chapterId, title: t }
}

/** Create a root chapter at the end of the book. Returns its content view. */
export function createChapter(bookId: string, title: string): ChapterContentView {
  return createChildChapter(bookId, null, title)
}

/** Create a child chapter under `parentId` (or a root chapter when null). The
 *  new chapter is appended after the last sibling (or last root); its `level`
 *  is derived from the parent's level (or '1' for roots), capped at
 *  MAX_CHAPTER_DEPTH. Returns the refreshed chapter content. */
export function createChildChapter(
  bookId: string,
  parentId: string | null,
  title: string,
): ChapterContentView {
  const t = title.trim()
  if (!t) throw new AppError('VALIDATION', '章节名不能为空')
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  return db.transaction(() => {
    const book = db
      .prepare('SELECT 1 FROM books WHERE id = ? AND deleted_at IS NULL')
      .get(bookId)
    if (!book) throw new AppError('NOT_FOUND', `书籍 ${bookId} 不存在`)

    let parentLevel: number
    let siblingFilter: string
    let siblingArgs: unknown[]
    if (parentId) {
      const parent = db
        .prepare('SELECT level FROM chapters WHERE id = ? AND book_id = ? AND deleted_at IS NULL')
        .get(parentId, bookId) as { level: string | null } | undefined
      if (!parent) throw new AppError('NOT_FOUND', `父章节 ${parentId} 不存在`)
      parentLevel = Number(parent.level ?? '1') || 1
      if (parentLevel >= MAX_CHAPTER_DEPTH) {
        throw new AppError('VALIDATION', `章节层级不能超过 ${MAX_CHAPTER_DEPTH} 级`)
      }
      siblingFilter = 'parent_id = ? AND book_id = ? AND deleted_at IS NULL'
      siblingArgs = [parentId, bookId]
    } else {
      parentLevel = 0
      siblingFilter = 'parent_id IS NULL AND book_id = ? AND deleted_at IS NULL'
      siblingArgs = [bookId]
    }

    const maxOrder = db
      .prepare(`SELECT COALESCE(MAX(order_index), -1) AS m FROM chapters WHERE ${siblingFilter}`)
      .get(...siblingArgs) as { m: number }

    db.prepare(
      `INSERT INTO chapters (id, book_id, parent_id, order_index, level, title, content, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', NULL, ?, ?)`,
    ).run(id, bookId, parentId, maxOrder.m + 1, String(parentLevel + 1), t, now, now)

    const refreshed = getChapterContent(bookId, id)
    if (!refreshed) throw new AppError('NOT_FOUND', `章节 ${id} 不存在`)
    return refreshed
  })()
}

/** Delete a chapter and its subtree. We HARD-delete so that the FK CASCADE
 *  children (excerpts, chapter_analyses, ai_threads/ai_messages) are cleaned up
 *  — soft-deleting would leave orphans (FK CASCADE only fires on real DELETE).
 *  notes.chapter_id is SET NULL by FK on the chapter delete, so free notes
 *  survive. reading_progress rows referencing these chapters are removed.
 *
 *  Subtree collection: chapters use a self-referential parent_id FK with
 *  CASCADE, so deleting a parent already cascades to children — but we collect
 *  the subtree explicitly first to clear reading_progress for all of them
 *  (progress rows would otherwise become orphans since their FK is on book_id). */
export function deleteChapter(chapterId: string): { ok: true } {
  const db = getDb()
  return db.transaction(() => {
    const row = db
      .prepare('SELECT book_id FROM chapters WHERE id = ? AND deleted_at IS NULL')
      .get(chapterId) as { book_id: string } | undefined
    if (!row) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)

    // collect this chapter + all descendants (recursive parent_id closure) so we
    // can clear their reading_progress rows explicitly.
    const toDelete = new Set<string>([chapterId])
    let frontier = [chapterId]
    while (frontier.length > 0) {
      const ph = frontier.map(() => '?').join(',')
      const children = db
        .prepare(`SELECT id FROM chapters WHERE parent_id IN (${ph}) AND deleted_at IS NULL`)
        .all(...frontier) as { id: string }[]
      frontier = []
      for (const c of children) {
        if (!toDelete.has(c.id)) {
          toDelete.add(c.id)
          frontier.push(c.id)
        }
      }
    }

    const delPh = [...toDelete].map(() => '?').join(',')
    // clear progress rows referencing these chapters
    db.prepare(`DELETE FROM reading_progress WHERE chapter_id IN (${delPh})`).run(...toDelete)
    // HARD-delete the chapters → FK CASCADE removes excerpts / chapter_analyses /
    // ai_threads(+ai_messages); FK SET NULL detaches notes (free notes survive).
    db.prepare(`DELETE FROM chapters WHERE id IN (${delPh})`).run(...toDelete)
    return { ok: true as const }
  })()
}

// ============================================================================
// Chapter content edit (+ re-anchor excerpts / selection notes)
// ============================================================================

/**
 * Save the whole-chapter plain text. Writes chapters.content + content_hash +
 * updated_at, then RE-ANCHORS every excerpt and selection-bound note whose
 * offsets reference this chapter: surviving anchors get updated offsets, lost
 * ones are flagged stale (the excerpt_text / quote_text snapshot is preserved).
 * fts_chapters is kept in sync by the chapters_au trigger.
 */
export function saveChapterContent(chapterId: string, text: string): ChapterContentView {
  const body = text
  const db = getDb()
  const now = Date.now()
  return db.transaction(() => {
    const row = db
      .prepare(
        'SELECT id, book_id, content FROM chapters WHERE id = ? AND deleted_at IS NULL',
      )
      .get(chapterId) as { id: string; book_id: string; content: string | null } | undefined
    if (!row) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)

    const oldText = row.content ?? ''
    const newHash = sha256Hex16(normalize(body))
    db.prepare(
      `UPDATE chapters SET content = ?, content_hash = ?, updated_at = ? WHERE id = ?`,
    ).run(body, newHash, now, chapterId)

    if (oldText !== body) {
      // re-anchor excerpts
      reanchorExcerpts(chapterId, oldText, body)
      // re-anchor selection-bound notes (those with start_offset set)
      const notes = db
        .prepare(
          `SELECT id, start_offset, end_offset, quote_text, stale
             FROM notes
            WHERE chapter_id = ? AND start_offset IS NOT NULL AND deleted_at IS NULL`,
        )
        .all(chapterId) as {
        id: string
        start_offset: number
        end_offset: number
        quote_text: string | null
        stale: number
      }[]
      const updNote = db.prepare(
        `UPDATE notes SET start_offset = ?, end_offset = ?, stale = ?, updated_at = ? WHERE id = ?`,
      )
      for (const n of notes) {
        const res = reanchorRange({
          oldText,
          newText: body,
          start: n.start_offset,
          end: n.end_offset,
          excerptText: n.quote_text ?? '',
        })
        updNote.run(res.start, res.end, res.stale, now, n.id)
      }
    }

    const refreshed = getChapterContent(row.book_id, chapterId)
    if (!refreshed) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
    return refreshed
  })()
}
