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

// ---------- SRH (search) DTOs — mirror electron/services/search.ts ----------

export interface SearchHit {
  paragraphId: string
  chapterId: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  /** Snippet with <mark>...</mark> around matched terms. */
  snippet: string
  /** bm25 score — lower is more relevant; 0 on the LIKE downgrade path. */
  score: number
  orderIndex: number
}

export interface SearchResult {
  total: number
  hits: SearchHit[]
  /** true when the query was too short for trigram and ran a LIKE scan. */
  degraded: boolean
}

export interface HighlightLoc {
  paragraphId: string
  chapterId: string
  bookId: string
  count: number
}

export interface Term {
  termId: string
  term: string
  definition: string | null
  source: string | null
  category: string | null
  attributes: string | null
  createdBy: string
  paragraphId: string | null
  createdAt: number
  updatedAt: number
}

export interface TermOccurrence {
  paragraphId: string
  chapterId: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  count: number
}

export interface TermDetail extends Term {
  occurrences: TermOccurrence[]
}
