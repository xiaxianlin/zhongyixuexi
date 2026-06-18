/**
 * Editing service — user content edits (book/chapter/paragraph text) + paragraph
 * merge/split. Pure DB writes; FTS sync is automatic (the paragraphs_ai/ad/au
 * triggers fire on UPDATE/soft-delete). The schema version is NOT bumped — these
 * operations reuse existing columns (text, edited, parse_hash, quality_flag,
 * order_index, deleted_at).
 *
 * Conventions (per plan + 01-import-parse §7.2.3):
 * - Editing paragraph text recomputes parse_hash (sha256Hex16(normalize(text))),
 *   sets edited=1, and flags quality_flag='suspect' if an active analysis exists.
 *   The OLD analysis is PRESERVED (not cleared) so the user can compare.
 * - merge/split generate NEW paragraph ids; the originals are SOFT-deleted
 *   (deleted_at=now). Because soft-delete does NOT fire FK CASCADE/SET NULL,
 *   notes bound to the original paragraphs are explicitly SET NULL so they
 *   survive as free notes. paragraph_analyses rows are left attached to the
 *   soft-deleted originals (preserved, per spec).
 * - Each operation runs in ONE transaction so order_index renumbering + the
 *   writes are atomic.
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { normalize } from './content-normalize'
import { sha256Hex16 } from './parse-hash'
import {
  activeAnalysisSql,
  mapParagraphAnalysisView,
  toParagraphInterpretationView,
  type ParagraphAnalysisSqlRow,
} from './paragraph-analysis'
import { getChapter, type ParagraphDTO, type ChapterContent } from './reading'

// ---------- shared helpers ----------

type ParagraphRow = Omit<ParagraphDTO, 'interpretation'> & ParagraphAnalysisSqlRow

/** Re-SELECT one paragraph with its active analysis joined (for editParagraphText return). */
function selectParagraph(paragraphId: string): ParagraphDTO {
  const db = getDb()
  const activeAnalysis = activeAnalysisSql()
  const row = db
    .prepare(
      `SELECT p.id, p.chapter_id, p.order_index, p.text,
              ${activeAnalysis.columns},
              p.edited, p.is_noise
       FROM paragraphs p
       ${activeAnalysis.join}
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(paragraphId) as ParagraphRow | undefined
  if (!row) throw new AppError('NOT_FOUND', `段落 ${paragraphId} 不存在`)
  return {
    id: row.id,
    chapter_id: row.chapter_id,
    order_index: row.order_index,
    text: row.text,
    edited: row.edited,
    is_noise: row.is_noise,
    interpretation: toParagraphInterpretationView(mapParagraphAnalysisView(row)),
  }
}

// ============================================================================
// Book / chapter title
// ============================================================================

/** Rename a book. Returns { id, title }. Throws NOT_FOUND if the book is gone. */
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

/** Rename a chapter. chapters has no updated_at column. Throws NOT_FOUND if gone. */
export function editChapterTitle(chapterId: string, title: string): { id: string; title: string } {
  const t = title.trim()
  if (!t) throw new AppError('VALIDATION', '章节名不能为空')
  const db = getDb()
  const result = db
    .prepare('UPDATE chapters SET title = ? WHERE id = ? AND deleted_at IS NULL')
    .run(t, chapterId)
  if (result.changes === 0) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
  return { id: chapterId, title: t }
}

// ============================================================================
// Paragraph text edit
// ============================================================================

/** Edit a paragraph's text. Recomputes parse_hash, sets edited=1, flags suspect
 *  if an active analysis exists (analysis itself is preserved). Returns the
 *  updated ParagraphDTO. */
export function editParagraphText(paragraphId: string, text: string): ParagraphDTO {
  const body = text.trim()
  if (!body) throw new AppError('VALIDATION', '段落内容不能为空')
  const db = getDb()
  const parseHash = sha256Hex16(normalize(body))
  return db.transaction(() => {
    const existing = db
      .prepare('SELECT id, chapter_id FROM paragraphs WHERE id = ? AND deleted_at IS NULL')
      .get(paragraphId) as { id: string; chapter_id: string } | undefined
    if (!existing) throw new AppError('NOT_FOUND', `段落 ${paragraphId} 不存在`)

    // Does an active analysis exist? If so, mark the paragraph suspect (old analysis preserved).
    const hasActive = db
      .prepare(
        `SELECT 1 FROM paragraph_analyses
         WHERE paragraph_id = ? AND kind = 'modern' AND is_active = 1 LIMIT 1`,
      )
      .get(paragraphId)

    const result = db
      .prepare(
        `UPDATE paragraphs
         SET text = ?, edited = 1, parse_hash = ?, quality_flag = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(body, parseHash, hasActive ? 'suspect' : null, paragraphId)
    if (result.changes === 0) throw new AppError('NOT_FOUND', `段落 ${paragraphId} 不存在`)

    return selectParagraph(paragraphId)
  })()
}

// ============================================================================
// Paragraph merge
// ============================================================================

interface ParagraphCoreRow {
  id: string
  chapter_id: string
  order_index: number
  text: string
}

/** Merge multiple paragraphs (selected in batch manage mode) into one. The
 *  originals are soft-deleted; one new paragraph is inserted with the combined
 *  text in chapter order_index order. All inputs must be in the same chapter.
 *  Returns the refreshed chapter content. */
export function mergeParagraphs(paragraphIds: string[]): ChapterContent {
  if (!Array.isArray(paragraphIds) || paragraphIds.length < 2) {
    throw new AppError('VALIDATION', '合并至少需要选择 2 个段落')
  }
  const unique = Array.from(new Set(paragraphIds))
  if (unique.length < 2) {
    throw new AppError('VALIDATION', '不能合并同一段落')
  }
  const db = getDb()
  return db.transaction(() => {
    const placeholders = unique.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT id, chapter_id, order_index, text FROM paragraphs
         WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      )
      .all(...unique) as ParagraphCoreRow[]
    if (rows.length !== unique.length) {
      throw new AppError('NOT_FOUND', '要合并的段落不存在')
    }
    const chapterIds = new Set(rows.map((r) => r.chapter_id))
    if (chapterIds.size !== 1) {
      throw new AppError('VALIDATION', '只能合并同一章节的段落')
    }
    const chapterId = rows[0]!.chapter_id
    // combine in chapter order_index order (regardless of selection order)
    const ordered = rows.sort((x, y) => x.order_index - y.order_index)
    const combinedText = ordered.map((r) => r.text).join('\n').trim()

    const now = Date.now()
    const newId = randomUUID()
    const parseHash = sha256Hex16(normalize(combinedText))
    const firstOrder = ordered[0]!.order_index

    // 1. soft-delete all originals
    db.prepare(`UPDATE paragraphs SET deleted_at = ? WHERE id IN (${placeholders})`).run(now, ...unique)
    // 2. detach notes bound to the originals (soft-delete doesn't fire FK SET NULL)
    db.prepare(
      `UPDATE notes SET paragraph_id = NULL, updated_at = ? WHERE paragraph_id IN (${placeholders})`,
    ).run(now, ...unique)
    // 3. insert the merged paragraph at the first original's order_index
    db.prepare(
      `INSERT INTO paragraphs (id, chapter_id, order_index, text, edited, parse_hash, is_noise, quality_flag, created_at)
       VALUES (?, ?, ?, ?, 1, ?, 0, NULL, ?)`,
    ).run(newId, chapterId, firstOrder, combinedText, parseHash, now)

    // 4. rebuild order_index for the whole chapter (compact sequence 0..n-1)
    renumberChapter(chapterId)

    return refreshChapterContent(chapterId)
  })()
}

/** Soft-delete multiple paragraphs (batch manage mode). Notes bound to them are
 *  SET NULL so they survive as free notes. Returns the refreshed chapter content. */
export function deleteParagraphs(paragraphIds: string[]): ChapterContent {
  if (!Array.isArray(paragraphIds) || paragraphIds.length === 0) {
    throw new AppError('VALIDATION', '请选择要删除的段落')
  }
  const unique = Array.from(new Set(paragraphIds))
  const db = getDb()
  return db.transaction(() => {
    const placeholders = unique.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT id, chapter_id FROM paragraphs WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
      )
      .all(...unique) as { id: string; chapter_id: string }[]
    if (rows.length === 0) throw new AppError('NOT_FOUND', '要删除的段落不存在')
    const chapterId = rows[0]!.chapter_id
    const liveIds = rows.map((r) => r.id)
    const livePlaceholders = liveIds.map(() => '?').join(', ')

    const now = Date.now()
    // soft-delete
    db.prepare(`UPDATE paragraphs SET deleted_at = ? WHERE id IN (${livePlaceholders})`).run(
      now,
      ...liveIds,
    )
    // detach notes (soft-delete doesn't fire FK SET NULL)
    db.prepare(
      `UPDATE notes SET paragraph_id = NULL, updated_at = ? WHERE paragraph_id IN (${livePlaceholders})`,
    ).run(now, ...liveIds)
    // paragraph_analyses left attached to soft-deleted paragraphs (preserved, per spec)

    renumberChapter(chapterId)
    return refreshChapterContent(chapterId)
  })()
}

// ============================================================================
// Paragraph split
// ============================================================================

/** Split a paragraph at a character offset. The original is soft-deleted; two
 *  new paragraphs are inserted (first half keeps the original order_index, second
 *  half follows). Returns the refreshed chapter content. */
export function splitParagraph(paragraphId: string, splitOffset: number): ChapterContent {
  const db = getDb()
  return db.transaction(() => {
    const para = db
      .prepare('SELECT id, chapter_id, order_index, text FROM paragraphs WHERE id = ? AND deleted_at IS NULL')
      .get(paragraphId) as ParagraphCoreRow | undefined
    if (!para) throw new AppError('NOT_FOUND', `段落 ${paragraphId} 不存在`)

    const text = para.text
    if (!Number.isInteger(splitOffset) || splitOffset <= 0 || splitOffset >= text.length) {
      throw new AppError('VALIDATION', '拆分位置必须在段落文本中间')
    }
    const firstText = text.slice(0, splitOffset).trim()
    const secondText = text.slice(splitOffset).trim()
    if (!firstText || !secondText) {
      throw new AppError('VALIDATION', '拆分后两段都不能为空')
    }

    const now = Date.now()
    const firstId = randomUUID()
    const secondId = randomUUID()

    // 1. soft-delete the original
    db.prepare('UPDATE paragraphs SET deleted_at = ? WHERE id = ?').run(now, para.id)
    // 2. detach notes bound to the original (soft-delete doesn't fire FK SET NULL)
    db.prepare('UPDATE notes SET paragraph_id = NULL, updated_at = ? WHERE paragraph_id = ?').run(
      now,
      para.id,
    )
    // 3. insert the two halves (first keeps original order_index, second follows)
    db.prepare(
      `INSERT INTO paragraphs (id, chapter_id, order_index, text, edited, parse_hash, is_noise, quality_flag, created_at)
       VALUES (?, ?, ?, ?, 1, ?, 0, NULL, ?)`,
    ).run(firstId, para.chapter_id, para.order_index, firstText, sha256Hex16(normalize(firstText)), now)
    db.prepare(
      `INSERT INTO paragraphs (id, chapter_id, order_index, text, edited, parse_hash, is_noise, quality_flag, created_at)
       VALUES (?, ?, ?, ?, 1, ?, 0, NULL, ?)`,
    ).run(secondId, para.chapter_id, para.order_index + 1, secondText, sha256Hex16(normalize(secondText)), now)

    // 4. rebuild order_index for the whole chapter
    renumberChapter(para.chapter_id)

    return refreshChapterContent(para.chapter_id)
  })()
}

// ============================================================================
// internal: order_index renumber + chapter refresh
// ============================================================================

/** Renumber all live paragraphs of a chapter to a compact 0..n-1 sequence. */
function renumberChapter(chapterId: string): void {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id FROM paragraphs WHERE chapter_id = ? AND deleted_at IS NULL ORDER BY order_index, created_at',
    )
    .all(chapterId) as { id: string }[]
  const stmt = db.prepare('UPDATE paragraphs SET order_index = ? WHERE id = ?')
  rows.forEach((row, index) => stmt.run(index, row.id))
}

/** Re-SELECT the chapter + its paragraphs (reuses the reading query shape). */
function refreshChapterContent(chapterId: string): ChapterContent {
  const db = getDb()
  const row = db.prepare('SELECT book_id FROM chapters WHERE id = ?').get(chapterId) as
    | { book_id: string }
    | undefined
  if (!row) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
  const chapter = getChapter(row.book_id, chapterId)
  if (!chapter) throw new AppError('NOT_FOUND', `章节 ${chapterId} 不存在`)
  return chapter
}
