/**
 * Library domain renderer DTOs (v3.1 chapter-level model) — content (books /
 * chapters), reading (chapter content view), excerpts. Mirrors the main-process
 * service return shapes in electron/services/{library,reading,excerpts}.ts.
 * Dependency-free so the renderer never imports electron/* code.
 */

// ---------- content (books / chapters) ----------

export interface ChapterDTO {
  id: string
  book_id: string
  parent_id: string | null
  order_index: number
  level: string | null
  title: string
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

export interface ChapterAnalysisView {
  modern: string | null
  explanation: string | null
  analysis: string | null
  summary: string | null
  meta: ChapterAnalysisMeta | null
}

/** v3.1 reading-pane payload (whole-chapter text + active analysis). */
export interface ChapterContentView {
  chapter: ChapterDTO
  content: string
  analysis: ChapterAnalysisView
}

// ---------- excerpts (v3.1 EXC module) ----------

export interface ExcerptDTO {
  id: string
  book_id: string
  chapter_id: string
  start_offset: number
  end_offset: number
  excerpt_text: string
  note: string | null
  stale: number
  created_at: number
  updated_at: number
}

export interface CreateExcerptInput {
  bookId?: string
  chapterId: string
  start: number
  end: number
  text: string
  note?: string | null
}

// ---------- notes (NOTE module, chapter + selection-bound) ----------

export interface NoteDTO {
  id: string
  content: string
  book_id: string | null
  chapter_id: string | null
  start_offset: number | null
  end_offset: number | null
  quote_text: string | null
  stale: number
  created_at: number
  updated_at: number
}

export interface CreateNoteInput {
  content?: string
  book_id?: string | null
  chapter_id?: string | null
  start_offset?: number | null
  end_offset?: number | null
  quote_text?: string | null
}

// ---------- editing (book/chapter title + chapter content + category) ----------

export interface EditBookTitleInput {
  id: string
  title: string
}

export interface EditChapterTitleInput {
  id: string
  title: string
}

export interface TitleResult {
  id: string
  title: string
}

// ---------- create / delete ----------

export interface CreateBookInput {
  title: string
  author?: string
}

export interface CreateChapterInput {
  bookId: string
  title: string
}

export interface CreateChildChapterInput {
  bookId: string
  parentId: string | null
  title: string
}

export interface DeleteInput {
  id: string
}

export interface SetBookCategoryInput {
  id: string
  category: 'classic' | 'modern'
}

export interface SetBookCategoryResult {
  id: string
  category: 'classic' | 'modern'
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
  scrollRatio: number
  readSeconds: number
  percent: number
}
