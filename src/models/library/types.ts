/**
 * Library domain renderer DTOs — content (books/chapters/paragraphs), reading
 * (chapter content view), and notes. Mirrors the main-process service return
 * shapes in electron/services/{library,reading,notes}.ts. Dependency-free so
 * the renderer never imports electron/* code.
 */

// ---------- content (books / chapters / paragraphs) ----------

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

// ---------- notes ----------

export interface CreateNoteInput {
  content?: string
  book_id?: string | null
  chapter_id?: string | null
  paragraph_id?: string | null
}

export interface ParagraphNoteCard {
  id: string
  content: string
  created_at: number
  updated_at: number
}

// ---------- editing (book/chapter/paragraph text + merge/split) ----------

export interface EditBookTitleInput {
  id: string
  title: string
}

export interface EditChapterTitleInput {
  id: string
  title: string
}

export interface EditTextInput {
  id: string
  text: string
}

export interface MergeParagraphsInput {
  paragraphIds: string[]
}

export interface DeleteParagraphsInput {
  paragraphIds: string[]
}

export interface SplitParagraphInput {
  paragraphId: string
  splitOffset: number
}

export interface TitleResult {
  id: string
  title: string
}

// ---------- reading progress ----------

/**
 * Reading-progress write payload (mirror of electron/services/reading.ts
 * SaveProgressInput). readSeconds is a DELTA (seconds spent since the previous
 * flush); the main process accumulates it onto the stored total.
 */
export interface SaveProgressInput {
  bookId: string
  chapterId: string
  paragraphId: string
  scrollRatio: number
  readSeconds: number
  percent: number
}
