/**
 * Cross-domain renderer DTOs (mirror of main-process service return shapes).
 * Kept dependency-free so the renderer never imports electron/* code; this
 * intentionally duplicates electron/models/content.ts and the library DTOs.
 *
 * Domain-specific DTOs live in their own models/<domain>/types.ts.
 */

export interface BookListItem {
  id: string
  title: string
  author: string | null
  cover: string | null
  category: string | null
  chapter_count: number
  paragraph_count: number
  progress: number
  updated_at: number
}

export interface ChapterNode {
  id: string
  title: string
  order_index: number
  level?: string | null
  /** 1 if the chapter has ≥1 analyzed paragraph, else 0 (mirrors backend). */
  analyzed?: number
  children: ChapterNode[]
}
