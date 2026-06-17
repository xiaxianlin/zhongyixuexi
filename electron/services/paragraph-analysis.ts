import { randomUUID } from 'node:crypto'
import { getDb } from '../db'
import { AppError } from '../lib/error'

export type ParagraphAnalysisSource = 'ai' | 'cache' | 'legacy'

export interface ParagraphAnalysisInput {
  paragraphId: string
  kind: ParagraphAnalysisKind
  modern: string
  explanation: string
  analysis: string
  summary: string | null
  model: string | null
  promptHash: string | null
  cacheId: string | null
  source: ParagraphAnalysisSource
  meta?: Record<string, unknown> | null
}

export interface BuildParagraphAnalysisInput {
  paragraphId: string
  kind?: ParagraphAnalysisKind
  content: {
    modern?: string | null
    explanation?: string | null
    analysis?: string | null
  }
  summary: string | null
  model: string | null
  promptHash: string | null
  cacheId: string | null
  source: ParagraphAnalysisSource
  meta?: Record<string, unknown> | null
}

export interface ParagraphAnalysisView {
  modern: string | null
  explanation: string | null
  analysis: string | null
  analysisMeta: ParagraphAnalysisMeta | null
}

export interface ParagraphInterpretationView {
  modern: string | null
  explanation: string | null
  analysis: string | null
  meta: ParagraphAnalysisMeta | null
}

export interface ParagraphInterpretationDTO extends ParagraphInterpretationView {
  cached: boolean
}

export interface ParagraphAnalysisMeta {
  id: string
  kind: ParagraphAnalysisKind
  version: number
  source: string
  model: string | null
  meta: Record<string, unknown> | null
  created_at: number
  updated_at: number
}

export interface ParagraphAnalysisHistoryItem extends ParagraphAnalysisMeta {
  is_active: boolean
  summary: string | null
  prompt_hash: string | null
  cache_id: string | null
  meta: Record<string, unknown> | null
}

interface ParagraphAnalysisHistoryRow
  extends Omit<ParagraphAnalysisHistoryItem, 'is_active' | 'meta'> {
  is_active: number
  meta: string | null
}

interface ParagraphAnalysisRecord extends ParagraphAnalysisHistoryRow {
  paragraph_id: string
  kind: ParagraphAnalysisKind
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
  analysis_meta: string | null
  analysis_kind: ParagraphAnalysisKind | null
  analysis_created_at: number | null
  analysis_updated_at: number | null
}

export const PARAGRAPH_ANALYSIS_KINDS = ['modern'] as const
export type ParagraphAnalysisKind = (typeof PARAGRAPH_ANALYSIS_KINDS)[number]
export const DEFAULT_PARAGRAPH_ANALYSIS_KIND: ParagraphAnalysisKind = 'modern'

export interface ActiveAnalysisSqlOptions {
  kind?: ParagraphAnalysisKind
  paragraphAlias?: string
  analysisAlias?: string
}

const ANALYSIS_KIND_SQL: Record<ParagraphAnalysisKind, string> = {
  modern: "'modern'",
}

function sqlAnalysisKind(kind: ParagraphAnalysisKind): string {
  return ANALYSIS_KIND_SQL[kind]
}

function activeAnalysisSqlAliases(options: ActiveAnalysisSqlOptions = {}): {
  paragraphAlias: string
  analysisAlias: string
  kind: ParagraphAnalysisKind
} {
  return {
    paragraphAlias: options.paragraphAlias ?? 'p',
    analysisAlias: options.analysisAlias ?? 'pa',
    kind: options.kind ?? DEFAULT_PARAGRAPH_ANALYSIS_KIND,
  }
}

export function selectActiveAnalysisColumns(options: ActiveAnalysisSqlOptions = {}): string {
  const { paragraphAlias, analysisAlias } = activeAnalysisSqlAliases(options)
  return `
COALESCE(${analysisAlias}.modern, ${paragraphAlias}.content_modern) AS content_modern,
COALESCE(${analysisAlias}.explanation, ${paragraphAlias}.content_explanation) AS content_explanation,
COALESCE(${analysisAlias}.analysis, ${paragraphAlias}.content_analysis) AS content_analysis,
${analysisAlias}.id AS analysis_id,
${analysisAlias}.kind AS analysis_kind,
${analysisAlias}.version AS analysis_version,
${analysisAlias}.source AS analysis_source,
${analysisAlias}.model AS analysis_model,
${analysisAlias}.meta AS analysis_meta,
${analysisAlias}.created_at AS analysis_created_at,
${analysisAlias}.updated_at AS analysis_updated_at`
}

export function joinActiveAnalysis(
  options: ActiveAnalysisSqlOptions = {},
): string {
  const { paragraphAlias, analysisAlias, kind } = activeAnalysisSqlAliases(options)
  return `
LEFT JOIN paragraph_analyses ${analysisAlias}
  ON ${analysisAlias}.paragraph_id = ${paragraphAlias}.id
 AND ${analysisAlias}.kind = ${sqlAnalysisKind(kind)}
 AND ${analysisAlias}.is_active = 1`
}

export function activeAnalysisSql(options: ActiveAnalysisSqlOptions = {}): {
  columns: string
  join: string
} {
  return {
    columns: selectActiveAnalysisColumns(options),
    join: joinActiveAnalysis(options),
  }
}

export function mapParagraphAnalysisMeta(
  row: Pick<
    ParagraphAnalysisSqlRow,
    | 'analysis_id'
    | 'analysis_kind'
    | 'analysis_version'
    | 'analysis_source'
    | 'analysis_model'
    | 'analysis_meta'
    | 'analysis_created_at'
    | 'analysis_updated_at'
  >,
): ParagraphAnalysisMeta | null {
  if (!row.analysis_id || row.analysis_version == null || !row.analysis_source) {
    return null
  }
  return {
    id: row.analysis_id,
    kind: row.analysis_kind ?? DEFAULT_PARAGRAPH_ANALYSIS_KIND,
    version: row.analysis_version,
    source: row.analysis_source,
    model: row.analysis_model,
    meta: parseParagraphAnalysisMetaJson(row.analysis_meta),
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

export function hasParagraphAnalysisContent(view: ParagraphAnalysisView): boolean {
  return view.modern != null || view.explanation != null || view.analysis != null
}

export function normalizeParagraphAnalysisContent(
  view: {
    modern?: string | null
    explanation?: string | null
    analysis?: string | null
  },
): { modern: string; explanation: string; analysis: string } {
  return {
    modern: view.modern ?? '',
    explanation: view.explanation ?? '',
    analysis: view.analysis ?? '',
  }
}

export function buildParagraphAnalysisInput(
  input: BuildParagraphAnalysisInput,
): ParagraphAnalysisInput {
  return {
    paragraphId: input.paragraphId,
    kind: input.kind ?? DEFAULT_PARAGRAPH_ANALYSIS_KIND,
    ...normalizeParagraphAnalysisContent(input.content),
    summary: input.summary,
    model: input.model,
    promptHash: input.promptHash,
    cacheId: input.cacheId,
    source: input.source,
    meta: input.meta,
  }
}

export function toParagraphInterpretationView(
  view: ParagraphAnalysisView,
): ParagraphInterpretationView {
  return {
    modern: view.modern,
    explanation: view.explanation,
    analysis: view.analysis,
    meta: view.analysisMeta,
  }
}

export function toParagraphInterpretationDTO(
  view: ParagraphAnalysisView,
): ParagraphInterpretationDTO {
  return {
    ...toParagraphInterpretationView(view),
    cached: hasParagraphAnalysisContent(view),
  }
}

export function mapParagraphAnalysisHistoryItem(
  row: ParagraphAnalysisHistoryRow,
): ParagraphAnalysisHistoryItem {
  return {
    ...row,
    is_active: row.is_active === 1,
    meta: parseParagraphAnalysisMetaJson(row.meta),
  }
}

export function parseParagraphAnalysisMetaJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

export function writeActiveParagraphAnalysis(input: ParagraphAnalysisInput): ParagraphAnalysisMeta {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  const kind = input.kind ?? DEFAULT_PARAGRAPH_ANALYSIS_KIND
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(version), 0) AS version
       FROM paragraph_analyses
       WHERE paragraph_id = ? AND kind = ?`,
    )
    .get(input.paragraphId, kind) as { version: number } | undefined
  const version = (row?.version ?? 0) + 1

  db.prepare(
    `UPDATE paragraph_analyses
     SET is_active = 0, updated_at = ?
     WHERE paragraph_id = ? AND kind = ? AND is_active = 1`,
  ).run(now, input.paragraphId, kind)
  db.prepare(
    `INSERT INTO paragraph_analyses (
       id, paragraph_id, kind, version, is_active, modern, explanation,
       analysis, summary, model, prompt_hash, cache_id, source,
       created_at, updated_at, meta
     )
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.paragraphId,
    kind,
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
    kind,
    version,
    source: input.source,
    model: input.model,
    meta: input.meta ?? null,
    created_at: now,
    updated_at: now,
  }
}

export function writeActiveParagraphAnalysisWithLegacySync(
  input: ParagraphAnalysisInput,
): ParagraphAnalysisMeta {
  const meta = writeActiveParagraphAnalysis(input)
  syncLegacyParagraphAnalysisColumns({
    paragraphId: input.paragraphId,
    modern: input.modern,
    explanation: input.explanation,
    analysis: input.analysis,
  })
  return meta
}

export function ensureActiveParagraphAnalysisWithLegacySync(
  input: ParagraphAnalysisInput,
): ParagraphAnalysisMeta {
  const kind = input.kind ?? DEFAULT_PARAGRAPH_ANALYSIS_KIND
  if (!hasActiveParagraphAnalysis(input.paragraphId, input.cacheId, kind)) {
    return writeActiveParagraphAnalysisWithLegacySync(input)
  }
  syncLegacyParagraphAnalysisColumns({
    paragraphId: input.paragraphId,
    modern: input.modern,
    explanation: input.explanation,
    analysis: input.analysis,
  })
  const meta = getActiveParagraphAnalysisMeta(input.paragraphId, kind)
  if (!meta) {
    throw new AppError('NOT_FOUND', `active paragraph analysis for ${input.paragraphId} not found`)
  }
  return meta
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

export function hasActiveParagraphAnalysis(
  paragraphId: string,
  cacheId: string | null,
  kind: ParagraphAnalysisKind = DEFAULT_PARAGRAPH_ANALYSIS_KIND,
): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1
       FROM paragraph_analyses
       WHERE paragraph_id = ?
         AND kind = ?
         AND is_active = 1
         AND ((cache_id IS NULL AND ? IS NULL) OR cache_id = ?)
       LIMIT 1`,
    )
    .get(paragraphId, kind, cacheId, cacheId)
  return Boolean(row)
}

export function getActiveParagraphAnalysisMeta(
  paragraphId: string,
  kind: ParagraphAnalysisKind = DEFAULT_PARAGRAPH_ANALYSIS_KIND,
): ParagraphAnalysisMeta | null {
  const row = getDb()
    .prepare(
      `SELECT id, kind, version, source, model, meta, created_at, updated_at
       FROM paragraph_analyses
       WHERE paragraph_id = ? AND kind = ? AND is_active = 1
       LIMIT 1`,
    )
    .get(paragraphId, kind) as
    | (Omit<ParagraphAnalysisMeta, 'meta'> & { meta: string | null })
    | undefined
  return row
    ? {
        ...row,
        meta: parseParagraphAnalysisMetaJson(row.meta),
      }
    : null
}

export function getActiveParagraphAnalysisView(
  paragraphId: string,
  kind: ParagraphAnalysisKind = DEFAULT_PARAGRAPH_ANALYSIS_KIND,
): ParagraphAnalysisView | null {
  const activeAnalysis = activeAnalysisSql({ kind })
  const row = getDb()
    .prepare(
      `SELECT ${activeAnalysis.columns}
       FROM paragraphs p
       ${activeAnalysis.join}
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(paragraphId) as ParagraphAnalysisSqlRow | undefined
  return row ? mapParagraphAnalysisView(row) : null
}

export function listParagraphAnalysisHistory(
  paragraphId: string,
  kind: ParagraphAnalysisKind = DEFAULT_PARAGRAPH_ANALYSIS_KIND,
): ParagraphAnalysisHistoryItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id,
              kind,
              version,
              is_active,
              source,
              model,
              summary,
              prompt_hash,
              cache_id,
              meta,
              created_at,
              updated_at
       FROM paragraph_analyses
       WHERE paragraph_id = ? AND kind = ?
       ORDER BY version DESC, created_at DESC`,
    )
    .all(paragraphId, kind) as ParagraphAnalysisHistoryRow[]
  return rows.map(mapParagraphAnalysisHistoryItem)
}

export function activateParagraphAnalysis(
  paragraphId: string,
  analysisId: string,
  kind: ParagraphAnalysisKind = DEFAULT_PARAGRAPH_ANALYSIS_KIND,
): ParagraphAnalysisView {
  const db = getDb()
  return db.transaction(() => {
    const row = db
      .prepare(
        `SELECT id,
                paragraph_id,
                kind,
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
                meta,
                created_at,
                updated_at
         FROM paragraph_analyses
         WHERE id = ? AND paragraph_id = ? AND kind = ?`,
      )
      .get(analysisId, paragraphId, kind) as ParagraphAnalysisRecord | undefined
    if (!row) {
      throw new AppError('NOT_FOUND', `paragraph analysis ${analysisId} not found`)
    }

    const now = Date.now()
    db.prepare(
      `UPDATE paragraph_analyses
       SET is_active = 0, updated_at = ?
       WHERE paragraph_id = ? AND kind = ? AND is_active = 1`,
    ).run(now, paragraphId, kind)
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
        kind: row.kind,
        version: row.version,
        source: row.source,
        model: row.model,
        meta: parseParagraphAnalysisMetaJson(row.meta),
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
