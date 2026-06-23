/**
 * Chapter-analysis service (v3.1 detail revamp).
 *
 * Read + write paths for the chapter_analyses table (schema v4). The reading
 * pane reads the active analysis via getActiveChapterAnalysis; slice D4 adds
 * the generation write path (writeActiveChapterAnalysis, versioning, history).
 */
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'

export interface ChapterAnalysisView {
  modern: string | null
  explanation: string | null
  analysis: string | null
  summary: string | null
}

export interface ChapterAnalysisMeta {
  id: string
  kind: string
  version: number
  source: string
  model: string | null
  created_at: number
  updated_at: number
}

export interface ActiveChapterAnalysis extends ChapterAnalysisView {
  meta: ChapterAnalysisMeta | null
}

interface ActiveChapterAnalysisRow {
  modern: string | null
  explanation: string | null
  analysis: string | null
  summary: string | null
  analysis_id: string | null
  analysis_kind: string | null
  analysis_version: number | null
  analysis_source: string | null
  analysis_model: string | null
  analysis_created_at: number | null
  analysis_updated_at: number | null
}

/** SQL fragment + join that left-joins the active 'chapter' chapter analysis.
 *  Use within a query that already aliases the chapters table as `c`. */
export function activeChapterAnalysisSql(): { columns: string; join: string } {
  return {
    columns: `ca.modern        AS modern,
              ca.explanation   AS explanation,
              ca.analysis      AS analysis,
              ca.summary       AS summary,
              ca.id            AS analysis_id,
              ca.kind          AS analysis_kind,
              ca.version       AS analysis_version,
              ca.source        AS analysis_source,
              ca.model         AS analysis_model,
              ca.created_at    AS analysis_created_at,
              ca.updated_at    AS analysis_updated_at`,
    join: `LEFT JOIN chapter_analyses ca
             ON ca.chapter_id = c.id
            AND ca.kind = 'chapter'
            AND ca.is_active = 1`,
  }
}

/** Map a joined row to the ActiveChapterAnalysis view shape. */
export function mapActiveChapterAnalysis(row: ActiveChapterAnalysisRow): ActiveChapterAnalysis {
  const hasMeta = row.analysis_id !== null
  return {
    modern: row.modern,
    explanation: row.explanation,
    analysis: row.analysis,
    summary: row.summary,
    meta: hasMeta
      ? {
          id: row.analysis_id!,
          kind: row.analysis_kind!,
          version: row.analysis_version!,
          source: row.analysis_source!,
          model: row.analysis_model,
          created_at: row.analysis_created_at!,
          updated_at: row.analysis_updated_at!,
        }
      : null,
  }
}

/** Fetch the active analysis for a chapter (or null when none exists). */
export function getActiveChapterAnalysis(chapterId: string): ActiveChapterAnalysis {
  const db = getDb()
  const a = activeChapterAnalysisSql()
  const row = db
    .prepare(
      `SELECT ${a.columns}
         FROM chapters c
         ${a.join}
        WHERE c.id = ? AND c.deleted_at IS NULL`,
    )
    .get(chapterId) as ActiveChapterAnalysisRow | undefined
  if (!row || row.analysis_id === null) {
    return { modern: null, explanation: null, analysis: null, summary: null, meta: null }
  }
  return mapActiveChapterAnalysis(row)
}

// ============================================================================
// Write path (D4) — active-unique versioning
// ============================================================================

export const DEFAULT_CHAPTER_ANALYSIS_KIND = 'chapter' as const
export type ChapterAnalysisKind = typeof DEFAULT_CHAPTER_ANALYSIS_KIND

export interface BuildChapterAnalysisInput {
  chapterId: string
  kind?: ChapterAnalysisKind
  content: {
    modern?: string | null
    explanation?: string | null
    analysis?: string | null
  }
  summary: string | null
  model: string | null
  promptHash: string | null
  cacheId: string | null
  source: 'ai' | 'cache'
  meta?: Record<string, unknown> | null
}

export interface ChapterAnalysisRecord {
  id: string
  chapter_id: string
  kind: ChapterAnalysisKind
  version: number
  is_active: number
  modern: string | null
  explanation: string | null
  analysis: string | null
  summary: string | null
  model: string | null
  prompt_hash: string | null
  cache_id: string | null
  source: string
  created_at: number
  updated_at: number
  meta: string | null
}

export interface ChapterAnalysisHistoryItem {
  id: string
  kind: ChapterAnalysisKind
  version: number
  is_active: boolean
  source: string
  model: string | null
  summary: string | null
  prompt_hash: string | null
  cache_id: string | null
  created_at: number
  updated_at: number
  meta: Record<string, unknown> | null
}

/**
 * Write a new active analysis for a chapter. Within one transaction:
 *  1. deactivate the previous active row (if any),
 *  2. insert the new row with version = (prev active version) + 1,
 *  3. return the new record.
 *
 * The active-unique partial index (uq_chapter_analyses_active) guarantees at
 * most one active row per (chapter_id, kind).
 */
export function writeActiveChapterAnalysis(
  input: BuildChapterAnalysisInput,
): ChapterAnalysisRecord {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const kind = input.kind ?? DEFAULT_CHAPTER_ANALYSIS_KIND
  return db.transaction(() => {
    const prev = db
      .prepare(
        `SELECT version FROM chapter_analyses
          WHERE chapter_id = ? AND kind = ? AND is_active = 1
          LIMIT 1`,
      )
      .get(input.chapterId, kind) as { version: number } | undefined
    const nextVersion = (prev?.version ?? 0) + 1

    // deactivate prior active rows (the partial index keeps at most one, but be
    // defensive in case of manual edits).
    db.prepare(
      `UPDATE chapter_analyses SET is_active = 0, updated_at = ?
        WHERE chapter_id = ? AND kind = ? AND is_active = 1`,
    ).run(now, input.chapterId, kind)

    db.prepare(
      `INSERT INTO chapter_analyses
         (id, chapter_id, kind, version, is_active, modern, explanation, analysis,
          summary, model, prompt_hash, cache_id, source, created_at, updated_at, meta)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.chapterId,
      kind,
      nextVersion,
      input.content.modern ?? null,
      input.content.explanation ?? null,
      input.content.analysis ?? null,
      input.summary,
      input.model,
      input.promptHash,
      input.cacheId,
      input.source,
      now,
      now,
      input.meta ? JSON.stringify(input.meta) : null,
    )

    return getChapterAnalysisRecord(id)!
  })()
}

/** Fetch one analysis record by id. */
export function getChapterAnalysisRecord(id: string): ChapterAnalysisRecord | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id, chapter_id, kind, version, is_active, modern, explanation, analysis,
              summary, model, prompt_hash, cache_id, source, created_at, updated_at, meta
         FROM chapter_analyses WHERE id = ?`,
    )
    .get(id) as ChapterAnalysisRecord | undefined
  return row ?? null
}

/** List all analysis versions for a chapter (newest first). */
export function listChapterAnalysisHistory(chapterId: string): ChapterAnalysisHistoryItem[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, kind, version, is_active, source, model, summary, prompt_hash,
              cache_id, created_at, updated_at, meta
         FROM chapter_analyses
        WHERE chapter_id = ?
        ORDER BY created_at DESC`,
    )
    .all(chapterId) as (Omit<ChapterAnalysisHistoryItem, 'is_active' | 'meta'> & {
      is_active: number
      meta: string | null
    })[]
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as ChapterAnalysisKind,
    version: r.version,
    is_active: r.is_active === 1,
    source: r.source,
    model: r.model,
    summary: r.summary,
    prompt_hash: r.prompt_hash,
    cache_id: r.cache_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
  }))
}

/** Activate a historical version (deactivates the current active). */
export function activateChapterAnalysis(
  chapterId: string,
  analysisId: string,
): ChapterAnalysisRecord | null {
  const db = getDb()
  const now = Date.now()
  db.transaction(() => {
    db.prepare(
      `UPDATE chapter_analyses SET is_active = 0, updated_at = ?
        WHERE chapter_id = ? AND is_active = 1`,
    ).run(now, chapterId)
    const res = db
      .prepare(
        `UPDATE chapter_analyses SET is_active = 1, updated_at = ?
          WHERE id = ? AND chapter_id = ?`,
      )
      .run(now, analysisId, chapterId)
    if (res.changes === 0) throw new Error(`分析 ${analysisId} 不存在`)
  })()
  return getChapterAnalysisRecord(analysisId)
}
