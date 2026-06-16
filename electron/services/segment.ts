/**
 * Segment-level editing (IMP-03). Operates on a chapter's paragraphs: edit
 * text, delete, merge with next, split, toggle noise. Structural changes
 * renumber order_index to keep it a clean integer sequence.
 *
 * Stable IDs (00-arch §5.5): merge keeps the first paragraph's id and
 * soft-deletes the next; split keeps the original id for the first half and
 * mints a new UUID for the second. So downstream references (notes/cards/AI
 * cache bound to paragraph_id) survive edits.
 *
 * FTS: all ops here are explicit UPDATE/INSERT/DELETE on paragraphs (NOT FK
 * cascade), so the fts_paragraphs triggers (S1.4) fire and keep the index in
 * sync automatically — no manual FTS work needed here.
 */
import { createHash, randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { normalize } from './import'

export interface SegmentParagraph {
  id: string
  order_index: number
  text: string
  edited: number
  is_noise: number
  quality_flag: string | null
}

function hash16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

/** Resequence live paragraphs in a chapter to 0..n-1 by current order. */
function renumberChapter(chapterId: string): void {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id FROM paragraphs WHERE chapter_id = ? AND deleted_at IS NULL ORDER BY order_index, id',
    )
    .all(chapterId) as { id: string }[]
  const upd = db.prepare('UPDATE paragraphs SET order_index = ? WHERE id = ?')
  db.transaction(() => {
    rows.forEach((r, i) => upd.run(i, r.id))
  })()
}

export function getChapterParagraphs(chapterId: string): SegmentParagraph[] {
  return getDb()
    .prepare(
      'SELECT id, order_index, text, edited, is_noise, quality_flag FROM paragraphs WHERE chapter_id = ? AND deleted_at IS NULL ORDER BY order_index',
    )
    .all(chapterId) as SegmentParagraph[]
}

export function updateParagraphText(id: string, text: string): void {
  const clean = normalize(text)
  getDb()
    .prepare('UPDATE paragraphs SET text = ?, parse_hash = ?, edited = 1 WHERE id = ?')
    .run(clean, hash16(clean), id)
}

export function deleteParagraph(id: string): void {
  const db = getDb()
  const row = db.prepare('SELECT chapter_id FROM paragraphs WHERE id = ?').get(id) as
    | { chapter_id: string }
    | undefined
  if (!row) return
  db.prepare('UPDATE paragraphs SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
  renumberChapter(row.chapter_id)
}

export function mergeWithNext(id: string): void {
  const db = getDb()
  const cur = db
    .prepare(
      'SELECT id, chapter_id, text, order_index FROM paragraphs WHERE id = ? AND deleted_at IS NULL',
    )
    .get(id) as { id: string; chapter_id: string; text: string; order_index: number } | undefined
  if (!cur) return
  const next = db
    .prepare(
      'SELECT id, text FROM paragraphs WHERE chapter_id = ? AND deleted_at IS NULL AND order_index > ? ORDER BY order_index LIMIT 1',
    )
    .get(cur.chapter_id, cur.order_index) as { id: string; text: string } | undefined
  if (!next) return // nothing after this one to merge

  const merged = normalize(`${cur.text}${next.text}`)
  db.transaction(() => {
    db.prepare('UPDATE paragraphs SET text = ?, parse_hash = ?, edited = 1 WHERE id = ?').run(
      merged,
      hash16(merged),
      cur.id,
    )
    db.prepare('UPDATE paragraphs SET deleted_at = ? WHERE id = ?').run(Date.now(), next.id)
  })()
  renumberChapter(cur.chapter_id)
}

export function splitParagraph(id: string, offset: number): void {
  const db = getDb()
  const cur = db
    .prepare(
      'SELECT id, chapter_id, text, order_index FROM paragraphs WHERE id = ? AND deleted_at IS NULL',
    )
    .get(id) as { id: string; chapter_id: string; text: string; order_index: number } | undefined
  if (!cur) return
  const safe = Math.max(0, Math.min(offset, cur.text.length))
  const part1 = normalize(cur.text.slice(0, safe))
  const part2 = normalize(cur.text.slice(safe))
  if (part1 === '' || part2 === '') return // refuse empty split

  db.transaction(() => {
    db.prepare('UPDATE paragraphs SET text = ?, parse_hash = ?, edited = 1 WHERE id = ?').run(
      part1,
      hash16(part1),
      cur.id,
    )
    db.prepare(
      `INSERT INTO paragraphs (id, chapter_id, order_index, text, parse_hash, edited, is_noise, quality_flag, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, 'ok', ?, NULL)`,
    ).run(randomUUID(), cur.chapter_id, cur.order_index + 1, part2, hash16(part2), Date.now())
  })()
  renumberChapter(cur.chapter_id)
}

export function setNoise(id: string, isNoise: boolean): void {
  getDb().prepare('UPDATE paragraphs SET is_noise = ? WHERE id = ?').run(isNoise ? 1 : 0, id)
}
