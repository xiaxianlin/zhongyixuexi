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
  content_modern: string | null
  content_explanation: string | null
  edited: number
  is_noise: number
}

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

export interface ProgressDTO {
  book_id: string
  chapter_id: string
  paragraph_id: string
  scroll_ratio: number
  read_seconds: number
  percent: number
  updated_at: number
}

export interface SaveProgressInput {
  book_id: string
  chapter_id: string
  paragraph_id: string
  scroll_ratio: number
  read_seconds?: number
  percent?: number
}

export interface BookmarkDTO {
  id: string
  book_id: string
  chapter_id: string
  paragraph_id: string | null
  title: string | null
  note: string | null
  color: string | null
  created_at: number
  updated_at: number
}

export interface AddBookmarkInput {
  book_id: string
  chapter_id: string
  paragraph_id?: string | null
  title?: string | null
  note?: string | null
  color?: string | null
}

export interface UpdateBookmarkInput {
  id: string
  title?: string | null
  note?: string | null
  color?: string | null
}

export interface InterpretationDTO {
  modern: string | null
  explanation: string | null
  cached: boolean
}

export interface TermLookupDTO {
  term: string
  definition: string | null
  category: string | null
  source: string | null
  found: boolean
}

/** Layout preset shape (cached in-memory for now; persists to settings in SET). */
export interface PanelState {
  visible: boolean
  /** 0..1 width fraction of the workbench the panel occupies when visible. */
  widthRatio: number
}

export interface ReadingLayout {
  original: PanelState
  interpret: PanelState
  resource: PanelState & { mode: 'resource' | 'notes' }
  syncScroll: boolean
  fontSize: number
  lineHeight: number
}

/** A reading tab (RD-10, single-window multi-tab MVP). */
export interface ReadingTab {
  id: string
  bookId: string
  chapterId: string | null
  title: string
}
