/**
 * Chapter-analysis service (v3.1 detail revamp).
 *
 * Mirrors paragraph-analysis.ts but keys on chapter_id and the
 * chapter_analyses table (added in schema v4). Write paths (building an active
 * analysis from the AI response, versioning, history) are added in slice D4;
 * this file currently exposes only the READ surface used by the reading pane
 * (D3) — fetching the active analysis view joined to a chapter.
 */
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

/** SQL fragment + join that left-joins the active 'modern' chapter analysis.
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
            AND ca.kind = 'modern'
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
