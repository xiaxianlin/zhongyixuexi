import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { readCoverAsDataUrl } from './covers'

/**
 * Library service (LIB module).
 *
 * Book list / detail and chapter-tree assembly.
 * All queries go through the better-sqlite3 singleton from getDb(); the
 * connection initializer enforces PRAGMA foreign_keys=ON (00-arch §5.1) so the
 * ON DELETE CASCADE declared on chapters/paragraphs/etc. actually fires.
 *
 * Column note: the current schema uses `id` as the stable
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
  chapter_count: number
  paragraph_count: number
  /** 0..1 reading progress. */
  progress: number
  updated_at: number
}

export interface ChapterNode {
  id: string
  title: string
  order_index: number
  level?: string | null
  /** 1 if the chapter has ≥1 analyzed (active paragraph_analyses) live paragraph, else 0. */
  analyzed?: number
  children: ChapterNode[]
}

/** Flat row shape consumed by buildChapterTree. */
export interface ChapterRow {
  id: string
  parent_id: string | null
  order_index: number
  title: string
  level?: string | null
  /** 0/1 from the EXISTS subquery in getChapterTree. */
  analyzed?: number
}

// ---------- list / detail ----------

/**
 * All live books (deleted_at IS NULL) with aggregated chapter_count,
 * paragraph_count and reading progress.
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
         b.updated_at,
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
       ORDER BY b.order_index ASC, b.title ASC`,
    )
    .all() as BookListItem[]
  // resolve cover stored filename → data URL (memoized in covers service)
  return rows.map((row) => ({
    ...row,
    cover: readCoverAsDataUrl(row.cover),
  }))
}

/** Reorder books: given an ordered list of book ids, write order_index = 0..n-1.
 *  Idempotent + atomic. Returns the refreshed list. */
export function reorderBooks(bookIds: string[]): BookListItem[] {
  if (!Array.isArray(bookIds) || bookIds.length === 0) {
    throw new AppError('VALIDATION', '书籍顺序不能为空')
  }
  const db = getDb()
  db.transaction(() => {
    const stmt = db.prepare('UPDATE books SET order_index = ? WHERE id = ?')
    bookIds.forEach((id, index) => stmt.run(index, id))
  })()
  return listBooks()
}

// ---------- chapter tree ----------

/**
 * Returns the chapter tree for a book as a nested structure, built in memory
 * from a single flat query (02-library §7.2: O(n) assembly, no recursive CTE).
 *
 * `analyzed` is 1 when the chapter has any active analysis — either a legacy
 * paragraph-level analysis (paragraph_analyses) or a v3.1 chapter-level one
 * (chapter_analyses). The detail page's tree badge lights up on either.
 */
export function getChapterTree(bookId: string): ChapterNode[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT c.id, c.parent_id, c.order_index, c.level, c.title,
              EXISTS (
                SELECT 1
                FROM paragraph_analyses pa
                JOIN paragraphs p ON p.id = pa.paragraph_id
                WHERE p.chapter_id = c.id
                  AND p.deleted_at IS NULL
                  AND p.is_noise = 0
                  AND pa.is_active = 1
              )
              OR EXISTS (
                SELECT 1
                FROM chapter_analyses ca
                WHERE ca.chapter_id = c.id
                  AND ca.is_active = 1
              ) AS analyzed
       FROM chapters c
       WHERE c.book_id = ? AND c.deleted_at IS NULL
       ORDER BY c.order_index`,
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
      analyzed: r.analyzed ?? 0,
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
