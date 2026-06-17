import { getDb } from '../db/connection'

/**
 * Library service (LIB module).
 *
 * Book list / detail and chapter-tree assembly.
 * All queries go through the better-sqlite3 singleton from getDb(); the
 * connection initializer enforces PRAGMA foreign_keys=ON (00-arch §5.1) so the
 * ON DELETE CASCADE declared on chapters/paragraphs/etc. actually fires.
 *
 * Column note: the real schema (db/migrate.ts v2) uses `id` as the stable
 * TEXT primary key on books/chapters/paragraphs (NOT `book_id`/`chapter_id`).
 * paragraphs.id is TEXT while the implicit `rowid` is what fts_paragraphs
 * (content='paragraphs', content_rowid='rowid') keys on.
 */

// ---------- DTOs (self-contained; do NOT import models/content.ts) ----------

export interface BookListItem {
  id: string
  title: string
  author: string | null
  cover: string | null
  category: string | null
  source_format: string
  chapter_count: number
  paragraph_count: number
  /** 0..1 reading progress. */
  progress: number
  imported_at: number
}

export interface ChapterListItem {
  id: string
  parent_id: string | null
  order_index: number
  level: string | null
  title: string
}

export interface BookDetail {
  id: string
  title: string
  author: string | null
  cover: string | null
  category: string | null
  source_format: string
  source_file: string
  imported_at: number
  updated_at: number
  chapter_count: number
  paragraph_count: number
  progress: number
  chapters: ChapterListItem[]
}

export interface ChapterNode {
  id: string
  title: string
  order_index: number
  level?: string | null
  children: ChapterNode[]
}

/** Flat row shape consumed by buildChapterTree. */
export interface ChapterRow {
  id: string
  parent_id: string | null
  order_index: number
  title: string
  level?: string | null
}

// ---------- list / detail ----------

/**
 * All live books (deleted_at IS NULL) with aggregated chapter_count,
 * paragraph_count and reading progress. Ordered by imported_at desc.
 */
export function listBooks(): BookListItem[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT
         b.id,
         b.title,
         b.author,
         b.cover,
         b.category,
         b.source_format,
         b.imported_at,
         COALESCE(s.chapter_count, 0)   AS chapter_count,
         COALESCE(s.paragraph_count, 0) AS paragraph_count,
         COALESCE(rp.percent, 0)        AS progress
       FROM books b
       LEFT JOIN (
         SELECT c.book_id                 AS book_id,
                COUNT(DISTINCT c.id)      AS chapter_count,
                COUNT(p.id)               AS paragraph_count
         FROM chapters c
         LEFT JOIN paragraphs p ON p.chapter_id = c.id AND p.deleted_at IS NULL
         WHERE c.deleted_at IS NULL
         GROUP BY c.book_id
       ) s ON s.book_id = b.id
       LEFT JOIN reading_progress rp ON rp.book_id = b.id
       WHERE b.deleted_at IS NULL
       ORDER BY b.imported_at DESC`,
    )
    .all() as BookListItem[]
  return rows
}

/** Single book with its flat chapter list. Returns null if not found / soft-deleted. */
export function getBook(bookId: string): BookDetail | null {
  const db = getDb()
  const book = db
    .prepare(
      `SELECT id, title, author, cover, category, source_format, source_file,
              imported_at, updated_at
       FROM books
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(bookId) as
    | {
        id: string
        title: string
        author: string | null
        cover: string | null
        category: string | null
        source_format: string
        source_file: string
        imported_at: number
        updated_at: number
      }
    | undefined
  if (!book) return null

  const chapters = db
    .prepare(
      `SELECT id, parent_id, order_index, level, title
       FROM chapters
       WHERE book_id = ? AND deleted_at IS NULL
       ORDER BY order_index`,
    )
    .all(bookId) as ChapterListItem[]

  const agg = db
    .prepare(
      `SELECT COUNT(DISTINCT c.id) AS chapter_count, COUNT(p.id) AS paragraph_count
       FROM chapters c
       LEFT JOIN paragraphs p ON p.chapter_id = c.id AND p.deleted_at IS NULL
       WHERE c.book_id = ? AND c.deleted_at IS NULL`,
    )
    .get(bookId) as { chapter_count: number; paragraph_count: number }

  return {
    ...book,
    chapter_count: agg.chapter_count ?? 0,
    paragraph_count: agg.paragraph_count ?? 0,
    progress: getBookProgress(bookId),
    chapters,
  }
}

function getBookProgress(bookId: string): number {
  const row = getDb()
    .prepare('SELECT percent FROM reading_progress WHERE book_id = ?')
    .get(bookId) as { percent: number } | undefined
  return row?.percent ?? 0
}

// ---------- chapter tree ----------

/**
 * Returns the chapter tree for a book as a nested structure, built in memory
 * from a single flat query (02-library §7.2: O(n) assembly, no recursive CTE).
 */
export function getChapterTree(bookId: string): ChapterNode[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, parent_id, order_index, level, title
       FROM chapters
       WHERE book_id = ? AND deleted_at IS NULL
       ORDER BY order_index`,
    )
    .all(bookId) as ChapterRow[]
  return buildChapterTree(rows)
}

/**
 * Pure tree builder. Given flat ChapterRow[] (already ordered by order_index),
 * assemble a nested ChapterNode[] tree.
 *
 * Algorithm: two-pass O(n log n).
 *  Pass 0 — sort a copy by order_index so siblings (roots and per-parent) are
 *           emitted in order regardless of input ordering.
 *  Pass 1 — index every row into a Map<id, node> with an empty children array.
 *  Pass 2 — walk the sorted rows; if parent_id resolves to a known node, attach
 *           as its child, otherwise (parent null OR orphan: parent points to an
 *           id not present in this set) attach to roots. Pre-sorting guarantees
 *           siblings retain order_index order within each bucket.
 *
 * Exported for unit testing without a database.
 */
export function buildChapterTree(flatRows: ChapterRow[]): ChapterNode[] {
  const sorted = [...flatRows].sort((a, b) => a.order_index - b.order_index)
  const map = new Map<string, ChapterNode>()
  const roots: ChapterNode[] = []

  for (const r of sorted) {
    map.set(r.id, {
      id: r.id,
      title: r.title,
      order_index: r.order_index,
      level: r.level ?? null,
      children: [],
    })
  }

  for (const r of sorted) {
    const node = map.get(r.id)!
    const parent = r.parent_id != null ? map.get(r.parent_id) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      // root (parent_id null) or orphan (parent_id set but not in this set) → root
      roots.push(node)
    }
  }

  return roots
}
