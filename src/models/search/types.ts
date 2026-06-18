/**
 * Search domain renderer DTOs — mirror electron/services/search.ts.
 */

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
