import type { Pool } from 'pg'
import { sanitizeSearchQuery } from './search'
import { buildChapterTree, type ChapterNode, type ChapterRow } from './tree'

export interface BookSummary {
  id: string
  title: string
  author: string | null
  cover: string | null
  category: string | null
  orderIndex: number
}

export async function listPublishedBooks(pool: Pool): Promise<BookSummary[]> {
  const { rows } = await pool.query<{
    id: string
    title: string
    author: string | null
    cover: string | null
    category: string | null
    order_index: number
  }>(
    `SELECT id, title, author, cover, category, order_index
     FROM books
     WHERE status = 'published' AND deleted_at IS NULL
     ORDER BY order_index`,
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    cover: r.cover,
    category: r.category,
    orderIndex: r.order_index,
  }))
}

export interface AdminBookSummary extends BookSummary {
  status: 'draft' | 'published'
}

/** CMS-01: the admin book list needs drafts too, not just what LIB-02 shows the public. */
export async function listAllBooksForAdmin(pool: Pool): Promise<AdminBookSummary[]> {
  const { rows } = await pool.query<{
    id: string
    title: string
    author: string | null
    cover: string | null
    category: string | null
    order_index: number
    status: 'draft' | 'published'
  }>(
    `SELECT id, title, author, cover, category, order_index, status
     FROM books
     WHERE deleted_at IS NULL
     ORDER BY order_index`,
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    author: r.author,
    cover: r.cover,
    category: r.category,
    orderIndex: r.order_index,
    status: r.status,
  }))
}

export interface ParagraphRow {
  id: string
  chapterId: string
  orderIndex: number
  text: string
}

export interface BookDetail {
  book: BookSummary
  chapters: ChapterNode[]
  paragraphsByChapter: Record<string, ParagraphRow[]>
}

export async function getBookDetail(
  pool: Pool,
  bookId: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<BookDetail | null> {
  const bookResult = await pool.query<{
    id: string
    title: string
    author: string | null
    cover: string | null
    category: string | null
    order_index: number
  }>(
    `SELECT id, title, author, cover, category, order_index
     FROM books
     WHERE id = $1 AND deleted_at IS NULL AND ($2::boolean OR status = 'published')`,
    [bookId, options.includeUnpublished ?? false],
  )
  const bookRow = bookResult.rows[0]
  if (!bookRow) return null

  const chapterResult = await pool.query<{
    id: string
    book_id: string
    parent_id: string | null
    order_index: number
    level: string | null
    title: string
  }>(
    `SELECT id, book_id, parent_id, order_index, level, title
     FROM chapters
     WHERE book_id = $1 AND deleted_at IS NULL
     ORDER BY order_index`,
    [bookId],
  )
  const chapterRows: ChapterRow[] = chapterResult.rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    parentId: r.parent_id,
    orderIndex: r.order_index,
    level: r.level,
    title: r.title,
  }))

  const paragraphResult = await pool.query<{
    id: string
    chapter_id: string
    order_index: number
    text: string
  }>(
    `SELECT p.id, p.chapter_id, p.order_index, p.text
     FROM paragraphs p
     JOIN chapters c ON c.id = p.chapter_id
     WHERE c.book_id = $1 AND p.deleted_at IS NULL AND c.deleted_at IS NULL
     ORDER BY p.chapter_id, p.order_index`,
    [bookId],
  )

  const paragraphsByChapter: Record<string, ParagraphRow[]> = {}
  for (const row of paragraphResult.rows) {
    const list = (paragraphsByChapter[row.chapter_id] ??= [])
    list.push({
      id: row.id,
      chapterId: row.chapter_id,
      orderIndex: row.order_index,
      text: row.text,
    })
  }

  return {
    book: {
      id: bookRow.id,
      title: bookRow.title,
      author: bookRow.author,
      cover: bookRow.cover,
      category: bookRow.category,
      orderIndex: bookRow.order_index,
    },
    chapters: buildChapterTree(chapterRows),
    paragraphsByChapter,
  }
}

export interface SearchHit {
  paragraphId: string
  chapterId: string
  bookId: string
  text: string
}

export async function searchParagraphs(
  pool: Pool,
  rawQuery: string,
  limit = 50,
): Promise<SearchHit[]> {
  const query = sanitizeSearchQuery(rawQuery)
  if (!query) return []

  const { rows } = await pool.query<{
    paragraph_id: string
    chapter_id: string
    book_id: string
    text: string
  }>(
    `SELECT p.id AS paragraph_id, p.chapter_id, c.book_id, p.text
     FROM paragraphs p
     JOIN chapters c ON c.id = p.chapter_id
     JOIN books b ON b.id = c.book_id
     WHERE p.deleted_at IS NULL AND c.deleted_at IS NULL
       AND b.status = 'published' AND b.deleted_at IS NULL
       AND p.text ILIKE '%' || $1 || '%'
     ORDER BY p.chapter_id, p.order_index
     LIMIT $2`,
    [query, limit],
  )

  return rows.map((r) => ({
    paragraphId: r.paragraph_id,
    chapterId: r.chapter_id,
    bookId: r.book_id,
    text: r.text,
  }))
}
