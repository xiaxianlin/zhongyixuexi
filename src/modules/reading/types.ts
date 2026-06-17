/**
 * Renderer-facing reading DTOs (mirror of the main-process service return shapes
 * in electron/services/reading.ts). Kept dependency-free so the renderer never
 * imports electron/* code; this intentionally duplicates the service DTOs.
 *
 * Shared with src/lib/types.ts consumers via re-export where needed.
 */

export interface ParagraphDTO {
  id: string
  chapter_id: string
  order_index: number
  text: string
  interpretation: InterpretationViewDTO
  edited: number
  is_noise: number
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

export type ParagraphAnalysisKind = 'modern'

export interface ChapterDTO {
  id: string
  book_id: string
  parent_id: string | null
  order_index: number
  level: string | null
  title: string
}

export interface ChapterContent {
  chapter: ChapterDTO
  paragraphs: ParagraphDTO[]
}

export interface InterpretationViewDTO {
  modern: string | null
  explanation: string | null
  analysis: string | null
  meta: ParagraphAnalysisMeta | null
}
