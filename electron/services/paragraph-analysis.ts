import { randomUUID } from 'node:crypto'
import { getDb } from '../db'

export interface ParagraphAnalysisInput {
  paragraphId: string
  modern: string
  explanation: string
  analysis: string
  summary: string | null
  model: string | null
  promptHash: string | null
  cacheId: string | null
  source: 'ai' | 'cache' | 'legacy'
  meta?: Record<string, unknown> | null
}

export interface ParagraphAnalysisView {
  modern: string | null
  explanation: string | null
  analysis: string | null
}

export const ACTIVE_ANALYSIS_JOIN = `
LEFT JOIN paragraph_analyses pa
  ON pa.paragraph_id = p.id
 AND pa.kind = 'modern'
 AND pa.is_active = 1`

export const ACTIVE_ANALYSIS_SELECT = `
COALESCE(pa.modern, p.content_modern) AS content_modern,
COALESCE(pa.explanation, p.content_explanation) AS content_explanation,
COALESCE(pa.analysis, p.content_analysis) AS content_analysis`

export function writeActiveParagraphAnalysis(input: ParagraphAnalysisInput): void {
  const db = getDb()
  const now = Date.now()
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(version), 0) AS version
       FROM paragraph_analyses
       WHERE paragraph_id = ? AND kind = 'modern'`,
    )
    .get(input.paragraphId) as { version: number } | undefined
  const version = (row?.version ?? 0) + 1

  db.prepare(
    `UPDATE paragraph_analyses
     SET is_active = 0, updated_at = ?
     WHERE paragraph_id = ? AND kind = 'modern' AND is_active = 1`,
  ).run(now, input.paragraphId)
  db.prepare(
    `INSERT INTO paragraph_analyses (
       id, paragraph_id, kind, version, is_active, modern, explanation,
       analysis, summary, model, prompt_hash, cache_id, source,
       created_at, updated_at, meta
     )
     VALUES (?, ?, 'modern', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.paragraphId,
    version,
    input.modern,
    input.explanation,
    input.analysis,
    input.summary,
    input.model,
    input.promptHash,
    input.cacheId,
    input.source,
    now,
    now,
    input.meta ? JSON.stringify(input.meta) : null,
  )
}

export function syncParagraphAnalysisColumns(input: ParagraphAnalysisView & { paragraphId: string }): void {
  getDb()
    .prepare(
      `UPDATE paragraphs
       SET content_modern = ?, content_explanation = ?, content_analysis = ?
       WHERE id = ?`,
    )
    .run(input.modern, input.explanation, input.analysis, input.paragraphId)
}

export function hasActiveParagraphAnalysis(paragraphId: string, cacheId: string | null): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1
       FROM paragraph_analyses
       WHERE paragraph_id = ?
         AND kind = 'modern'
         AND is_active = 1
         AND ((cache_id IS NULL AND ? IS NULL) OR cache_id = ?)
       LIMIT 1`,
    )
    .get(paragraphId, cacheId, cacheId)
  return Boolean(row)
}

export function deactivateParagraphAnalysesForBook(bookId: string, updatedAt: number): number {
  const result = getDb()
    .prepare(
      `UPDATE paragraph_analyses
       SET is_active = 0, updated_at = ?
       WHERE paragraph_id IN (
         SELECT id FROM paragraphs
         WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)
       )
         AND is_active = 1`,
    )
    .run(updatedAt, bookId)
  return result.changes
}
