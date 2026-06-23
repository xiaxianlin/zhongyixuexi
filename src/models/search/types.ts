/**
 * Search domain renderer DTOs — mirror electron/services/search.ts.
 *
 * v3.1 chapter-level model: results are chapters (not paragraphs). matchOffset
 * is the code-point offset of the first match within chapters.content, used to
 * scroll the reading pane to the hit.
 */

export interface SearchHit {
  chapterId: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  /** Snippet with <mark>...</mark> around matched terms. */
  snippet: string
  /** bm25 score — lower is more relevant; 0 on the LIKE downgrade path. */
  score: number
  /** Code-point offset of the first match within chapters.content (-1 unknown). */
  matchOffset: number
}

export interface SearchResult {
  total: number
  hits: SearchHit[]
  /** true when the query was too short for trigram and ran a LIKE scan. */
  degraded: boolean
}
