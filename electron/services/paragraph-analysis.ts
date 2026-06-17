import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { AppError } from '../lib/error'

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
  analysisMeta: ParagraphAnalysisMeta | null
}

export interface ParagraphAnalysisMeta {
  id: string
  version: number
  source: string
  model: string | null
  created_at: number
  updated_at: number
}

export interface ParagraphAnalysisHistoryItem extends ParagraphAnalysisMeta {
  is_active: boolean
  summary: string | null
  prompt_hash: string | null
  cache_id: string | null
}

interface ParagraphAnalysisHistoryRow extends Omit<ParagraphAnalysisHistoryItem, 'is_active'> {
  is_active: number
}

interface ParagraphAnalysisRecord extends ParagraphAnalysisHistoryRow {
  paragraph_id: string
  modern: string
  explanation: string
  analysis: string
}

export interface ParagraphAnalysisSqlRow {
  content_modern: string | null
  content_explanation: string | null
  content_analysis: string | null
  analysis_id: string | null
  analysis_version: number | null
  analysis_source: string | null
  analysis_model: string | null
  analysis_created_at: number | null
  analysis_updated_at: number | null
}

const ACTIVE_ANALYSIS_JOIN = `
LEFT JOIN paragraph_analyses pa
  ON pa.paragraph_id = p.id
 AND pa.kind = 'modern'
 AND pa.is_active = 1`

const ACTIVE_ANALYSIS_SELECT = `
COALESCE(pa.modern, p.content_modern) AS content_modern,
COALESCE(pa.explanation, p.content_explanation) AS content_explanation,
COALESCE(pa.analysis, p.content_analysis) AS content_analysis,
pa.id AS analysis_id,
pa.version AS analysis_version,
pa.source AS analysis_source,
pa.model AS analysis_model,
pa.created_at AS analysis_created_at,
pa.updated_at AS analysis_updated_at`

export function selectActiveAnalysisColumns(): string {
  return ACTIVE_ANALYSIS_SELECT
}

export function joinActiveAnalysis(): string {
  return ACTIVE_ANALYSIS_JOIN
}

export function mapParagraphAnalysisMeta(
  row: Pick<
    ParagraphAnalysisSqlRow,
    | 'analysis_id'
    | 'analysis_version'
    | 'analysis_source'
    | 'analysis_model'
    | 'analysis_created_at'
    | 'analysis_updated_at'
  >,
): ParagraphAnalysisMeta | null {
  if (!row.analysis_id || row.analysis_version == null || !row.analysis_source) {
    return null
  }
  return {
    id: row.analysis_id,
    version: row.analysis_version,
    source: row.analysis_source,
    model: row.analysis_model,
    created_at: row.analysis_created_at ?? 0,
    updated_at: row.analysis_updated_at ?? 0,
  }
}

export function mapParagraphAnalysisView(row: ParagraphAnalysisSqlRow): ParagraphAnalysisView {
  return {
    modern: row.content_modern,
    explanation: row.content_explanation,
    analysis: row.content_analysis,
    analysisMeta: mapParagraphAnalysisMeta(row),
  }
}

export function mapParagraphAnalysisHistoryItem(
  row: ParagraphAnalysisHistoryRow,
): ParagraphAnalysisHistoryItem {
  return {
    ...row,
    is_active: row.is_active === 1,
  }
}

export function writeActiveParagraphAnalysis(input: ParagraphAnalysisInput): ParagraphAnalysisMeta {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
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
    id,
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
  return {
    id,
    version,
    source: input.source,
    model: input.model,
    created_at: now,
    updated_at: now,
  }
}

export function syncLegacyParagraphAnalysisColumns(
  input: Pick<ParagraphAnalysisView, 'modern' | 'explanation' | 'analysis'> & { paragraphId: string },
): void {
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

export function getActiveParagraphAnalysisMeta(paragraphId: string): ParagraphAnalysisMeta | null {
  const row = getDb()
    .prepare(
      `SELECT id, version, source, model, created_at, updated_at
       FROM paragraph_analyses
       WHERE paragraph_id = ? AND kind = 'modern' AND is_active = 1
       LIMIT 1`,
    )
    .get(paragraphId) as ParagraphAnalysisMeta | undefined
  return row ?? null
}

export function getActiveParagraphAnalysisView(paragraphId: string): ParagraphAnalysisView | null {
  const row = getDb()
    .prepare(
      `SELECT ${ACTIVE_ANALYSIS_SELECT}
       FROM paragraphs p
       ${ACTIVE_ANALYSIS_JOIN}
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(paragraphId) as ParagraphAnalysisSqlRow | undefined
  return row ? mapParagraphAnalysisView(row) : null
}

export function listParagraphAnalysisHistory(paragraphId: string): ParagraphAnalysisHistoryItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id,
              version,
              is_active,
              source,
              model,
              summary,
              prompt_hash,
              cache_id,
              created_at,
              updated_at
       FROM paragraph_analyses
       WHERE paragraph_id = ? AND kind = 'modern'
       ORDER BY version DESC, created_at DESC`,
    )
    .all(paragraphId) as ParagraphAnalysisHistoryRow[]
  return rows.map(mapParagraphAnalysisHistoryItem)
}

export function activateParagraphAnalysis(
  paragraphId: string,
  analysisId: string,
): ParagraphAnalysisView {
  const db = getDb()
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id,
                paragraph_id,
                version,
                is_active,
                modern,
                explanation,
                analysis,
                summary,
                source,
                model,
                prompt_hash,
                cache_id,
                created_at,
                updated_at
         FROM paragraph_analyses
         WHERE id = ? AND paragraph_id = ? AND kind = 'modern'`,
      )
      .get(analysisId, paragraphId) as ParagraphAnalysisRecord | undefined
    if (!row) {
      throw new AppError('NOT_FOUND', `paragraph analysis ${analysisId} not found`)
    }

    const now = Date.now()
    db.prepare(
      `UPDATE paragraph_analyses
       SET is_active = 0, updated_at = ?
       WHERE paragraph_id = ? AND kind = 'modern' AND is_active = 1`,
    ).run(now, paragraphId)
    db.prepare(
      `UPDATE paragraph_analyses
       SET is_active = 1, updated_at = ?
       WHERE id = ?`,
    ).run(now, analysisId)
    db.prepare(
      `UPDATE paragraphs
       SET content_modern = ?, content_explanation = ?, content_analysis = ?
       WHERE id = ?`,
    ).run(row.modern, row.explanation, row.analysis, paragraphId)

    return {
      modern: row.modern,
      explanation: row.explanation,
      analysis: row.analysis,
      analysisMeta: {
        id: row.id,
        version: row.version,
        source: row.source,
        model: row.model,
        created_at: row.created_at,
        updated_at: now,
      },
    }
  })()
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
