/**
 * Renderer-facing DTOs (mirror of the main-process service return shapes).
 * Kept dependency-free so the renderer never imports electron/* code; this
 * duplicates electron/models/content.ts and the library DTOs intentionally.
 */

export interface BookListItem {
  id: string
  title: string
  author: string | null
  cover: string | null
  category: string | null
  source_format: string
  chapter_count: number
  paragraph_count: number
  progress: number
  imported_at: number
}

export interface ChapterNode {
  id: string
  title: string
  order_index: number
  level?: string | null
  children: ChapterNode[]
}

export interface ImportResult {
  bookId: string
  chapterCount: number
  paragraphCount: number
}

export interface ImportProgress {
  stage: string
  current?: number
  total?: number
  message?: string
}

export interface SegmentParagraph {
  id: string
  order_index: number
  text: string
  edited: number
  is_noise: number
  quality_flag: string | null
}
