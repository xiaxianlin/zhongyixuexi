/**
 * CMS-01 admin writes — ports electron/services/editing.ts to Postgres for the
 * content admin backend. Soft-delete (deleted_at) conventions and the merge/
 * split "new ids, originals soft-deleted, renumber the chapter" shape are
 * unchanged from the desktop app. Two things are simpler here than the
 * original: no notes table exists yet in Postgres (that lands in a later
 * slice), so there's no "detach live notes bound to the original paragraph"
 * step; and no FTS sync step, since the pg_trgm GIN index (S9.4) is
 * maintained transactionally by Postgres itself.
 */
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from '../db/with-transaction'
import { NotFoundError, ValidationError } from '../lib/errors'

async function renumberChapter(client: PoolClient, chapterId: string): Promise<void> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM paragraphs
     WHERE chapter_id = $1 AND deleted_at IS NULL
     ORDER BY order_index, created_at`,
    [chapterId],
  )
  for (let i = 0; i < rows.length; i += 1) {
    await client.query('UPDATE paragraphs SET order_index = $1 WHERE id = $2', [i, rows[i]!.id])
  }
}

// ---------- books ----------

export interface CreateBookInput {
  title: string
  author?: string | null
  category?: string | null
  cover?: string | null
}

export async function createBook(
  pool: Pool,
  input: CreateBookInput,
  createdBy: string,
): Promise<{ id: string; title: string }> {
  const title = input.title.trim()
  if (!title) throw new ValidationError('title is required')
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ max: number | null }>(
      'SELECT MAX(order_index) AS max FROM books WHERE deleted_at IS NULL',
    )
    const orderIndex = (rows[0]?.max ?? -1) + 1
    const id = randomUUID()
    await client.query(
      `INSERT INTO books (id, title, author, category, cover, order_index, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)`,
      [
        id,
        title,
        input.author?.trim() || null,
        input.category?.trim() || null,
        input.cover?.trim() || null,
        orderIndex,
        createdBy,
      ],
    )
    return { id, title }
  })
}

export interface UpdateBookInput {
  title?: string
  author?: string | null
  category?: string | null
  cover?: string | null
  orderIndex?: number
}

export async function updateBook(pool: Pool, bookId: string, input: UpdateBookInput): Promise<void> {
  const sets: string[] = []
  const values: unknown[] = []
  let i = 1

  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) throw new ValidationError('title cannot be empty')
    sets.push(`title = $${i++}`)
    values.push(title)
  }
  if (input.author !== undefined) {
    sets.push(`author = $${i++}`)
    values.push(input.author)
  }
  if (input.category !== undefined) {
    sets.push(`category = $${i++}`)
    values.push(input.category)
  }
  if (input.cover !== undefined) {
    sets.push(`cover = $${i++}`)
    values.push(input.cover)
  }
  if (input.orderIndex !== undefined) {
    sets.push(`order_index = $${i++}`)
    values.push(input.orderIndex)
  }
  if (sets.length === 0) return

  sets.push('updated_at = now()')
  values.push(bookId)
  const result = await pool.query(
    `UPDATE books SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL`,
    values,
  )
  if (result.rowCount === 0) throw new NotFoundError('book not found')
}

export async function setBookStatus(
  pool: Pool,
  bookId: string,
  status: 'draft' | 'published',
): Promise<void> {
  const result = await pool.query(
    'UPDATE books SET status = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL',
    [status, bookId],
  )
  if (result.rowCount === 0) throw new NotFoundError('book not found')
}

export async function deleteBook(pool: Pool, bookId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const exists = await client.query('SELECT 1 FROM books WHERE id = $1 AND deleted_at IS NULL', [
      bookId,
    ])
    if (exists.rowCount === 0) throw new NotFoundError('book not found')

    await client.query(
      `UPDATE paragraphs SET deleted_at = now()
       WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = $1 AND deleted_at IS NULL)
         AND deleted_at IS NULL`,
      [bookId],
    )
    await client.query(
      'UPDATE chapters SET deleted_at = now() WHERE book_id = $1 AND deleted_at IS NULL',
      [bookId],
    )
    await client.query('UPDATE books SET deleted_at = now() WHERE id = $1', [bookId])
  })
}

// ---------- chapters ----------

export async function createChapter(pool: Pool, bookId: string, title: string): Promise<{ id: string }> {
  const t = title.trim()
  if (!t) throw new ValidationError('chapter title is required')
  return withTransaction(pool, async (client) => {
    const book = await client.query('SELECT 1 FROM books WHERE id = $1 AND deleted_at IS NULL', [
      bookId,
    ])
    if (book.rowCount === 0) throw new NotFoundError('book not found')

    const { rows } = await client.query<{ max: number | null }>(
      'SELECT MAX(order_index) AS max FROM chapters WHERE book_id = $1 AND deleted_at IS NULL',
      [bookId],
    )
    const orderIndex = (rows[0]?.max ?? -1) + 1
    const id = randomUUID()
    await client.query('INSERT INTO chapters (id, book_id, order_index, title) VALUES ($1, $2, $3, $4)', [
      id,
      bookId,
      orderIndex,
      t,
    ])
    return { id }
  })
}

export async function updateChapterTitle(pool: Pool, chapterId: string, title: string): Promise<void> {
  const t = title.trim()
  if (!t) throw new ValidationError('chapter title is required')
  const result = await pool.query(
    'UPDATE chapters SET title = $1 WHERE id = $2 AND deleted_at IS NULL',
    [t, chapterId],
  )
  if (result.rowCount === 0) throw new NotFoundError('chapter not found')
}

export async function deleteChapter(pool: Pool, chapterId: string): Promise<void> {
  await withTransaction(pool, async (client) => {
    const exists = await client.query(
      'SELECT 1 FROM chapters WHERE id = $1 AND deleted_at IS NULL',
      [chapterId],
    )
    if (exists.rowCount === 0) throw new NotFoundError('chapter not found')

    await client.query(
      'UPDATE paragraphs SET deleted_at = now() WHERE chapter_id = $1 AND deleted_at IS NULL',
      [chapterId],
    )
    await client.query('UPDATE chapters SET deleted_at = now() WHERE id = $1', [chapterId])
  })
}

// ---------- paragraphs ----------

export async function createParagraph(
  pool: Pool,
  chapterId: string,
  text: string,
): Promise<{ id: string }> {
  const body = text.trim()
  if (!body) throw new ValidationError('paragraph text is required')
  return withTransaction(pool, async (client) => {
    const chapter = await client.query(
      'SELECT 1 FROM chapters WHERE id = $1 AND deleted_at IS NULL',
      [chapterId],
    )
    if (chapter.rowCount === 0) throw new NotFoundError('chapter not found')

    const { rows } = await client.query<{ max: number | null }>(
      'SELECT MAX(order_index) AS max FROM paragraphs WHERE chapter_id = $1 AND deleted_at IS NULL',
      [chapterId],
    )
    const orderIndex = (rows[0]?.max ?? -1) + 1
    const id = randomUUID()
    await client.query(
      'INSERT INTO paragraphs (id, chapter_id, order_index, text) VALUES ($1, $2, $3, $4)',
      [id, chapterId, orderIndex, body],
    )
    return { id }
  })
}

export async function editParagraphText(pool: Pool, paragraphId: string, text: string): Promise<void> {
  const body = text.trim()
  if (!body) throw new ValidationError('paragraph text is required')
  const result = await pool.query(
    'UPDATE paragraphs SET text = $1 WHERE id = $2 AND deleted_at IS NULL',
    [body, paragraphId],
  )
  if (result.rowCount === 0) throw new NotFoundError('paragraph not found')
}

export async function deleteParagraph(pool: Pool, paragraphId: string): Promise<{ chapterId: string }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ chapter_id: string }>(
      'SELECT chapter_id FROM paragraphs WHERE id = $1 AND deleted_at IS NULL',
      [paragraphId],
    )
    const row = rows[0]
    if (!row) throw new NotFoundError('paragraph not found')
    await client.query('UPDATE paragraphs SET deleted_at = now() WHERE id = $1', [paragraphId])
    await renumberChapter(client, row.chapter_id)
    return { chapterId: row.chapter_id }
  })
}

export async function mergeParagraphs(
  pool: Pool,
  paragraphIds: string[],
): Promise<{ chapterId: string }> {
  const unique = Array.from(new Set(paragraphIds))
  if (unique.length < 2) throw new ValidationError('merge requires at least 2 distinct paragraphs')

  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      id: string
      chapter_id: string
      order_index: number
      text: string
    }>(
      'SELECT id, chapter_id, order_index, text FROM paragraphs WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
      [unique],
    )
    if (rows.length !== unique.length) throw new NotFoundError('one or more paragraphs not found')

    const chapterIds = new Set(rows.map((r) => r.chapter_id))
    if (chapterIds.size !== 1) {
      throw new ValidationError('can only merge paragraphs within the same chapter')
    }
    const chapterId = rows[0]!.chapter_id
    const ordered = [...rows].sort((a, b) => a.order_index - b.order_index)
    const combinedText = ordered
      .map((r) => r.text)
      .join('\n')
      .trim()
    const firstOrder = ordered[0]!.order_index
    const newId = randomUUID()

    await client.query('UPDATE paragraphs SET deleted_at = now() WHERE id = ANY($1::uuid[])', [unique])
    await client.query(
      'INSERT INTO paragraphs (id, chapter_id, order_index, text) VALUES ($1, $2, $3, $4)',
      [newId, chapterId, firstOrder, combinedText],
    )
    await renumberChapter(client, chapterId)
    return { chapterId }
  })
}

export async function splitParagraph(
  pool: Pool,
  paragraphId: string,
  splitOffset: number,
): Promise<{ chapterId: string }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      id: string
      chapter_id: string
      order_index: number
      text: string
    }>('SELECT id, chapter_id, order_index, text FROM paragraphs WHERE id = $1 AND deleted_at IS NULL', [
      paragraphId,
    ])
    const para = rows[0]
    if (!para) throw new NotFoundError('paragraph not found')

    const text = para.text
    if (!Number.isInteger(splitOffset) || splitOffset <= 0 || splitOffset >= text.length) {
      throw new ValidationError('split offset must be within the paragraph text')
    }
    const firstText = text.slice(0, splitOffset).trim()
    const secondText = text.slice(splitOffset).trim()
    if (!firstText || !secondText) {
      throw new ValidationError('both halves must be non-empty after trimming')
    }

    const firstId = randomUUID()
    const secondId = randomUUID()

    await client.query('UPDATE paragraphs SET deleted_at = now() WHERE id = $1', [para.id])
    await client.query(
      'INSERT INTO paragraphs (id, chapter_id, order_index, text) VALUES ($1, $2, $3, $4)',
      [firstId, para.chapter_id, para.order_index, firstText],
    )
    await client.query(
      'INSERT INTO paragraphs (id, chapter_id, order_index, text) VALUES ($1, $2, $3, $4)',
      [secondId, para.chapter_id, para.order_index + 1, secondText],
    )
    await renumberChapter(client, para.chapter_id)
    return { chapterId: para.chapter_id }
  })
}
