/**
 * Search store (SRH, Zustand). Session/UI cache only — persisted data lives in
 * SQLite (dictionary_terms). Holds the current query, results, the active
 * highlight term, and the term-popup detail. Jump-to-paragraph is delegated to
 * the library detail page via the session store.
 */

import { create } from 'zustand'
import { searchApi } from '@/lib/search-api'
import { useSessionStore } from '@/stores/session'
import type { SearchResult, SearchHit, HighlightLoc, TermDetail } from '@/lib/types'

interface SearchState {
  query: string
  result: SearchResult | null
  loading: boolean
  error: string | null

  // SRH-05 highlight
  activeTerm: string | null
  highlightLocations: HighlightLoc[]

  // SRH-04 term popup
  activeTermDetail: TermDetail | null
  termDetailLoading: boolean

  runSearch: (q: string) => Promise<void>
  clear: () => void

  toggleHighlight: (term: string | null, scope?: { bookId?: string }) => Promise<void>

  openTerm: (termId: string) => Promise<void>
  closeTerm: () => void

  /** Jump to a search hit in the library detail page. */
  openHit: (hit: SearchHit) => void
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  result: null,
  loading: false,
  error: null,

  activeTerm: null,
  highlightLocations: [],

  activeTermDetail: null,
  termDetailLoading: false,

  runSearch: async (q) => {
    const query = q.trim()
    if (query === '') {
      set({ query: '', result: null, error: null })
      return
    }
    set({ query, loading: true, error: null })
    try {
      const result = await searchApi.fulltext({ query, limit: 50 })
      set({ result, loading: false })
    } catch (err) {
      set({ result: null, loading: false, error: (err as Error).message })
    }
  },

  clear: () => set({ query: '', result: null, error: null }),

  toggleHighlight: async (term, scope) => {
    if (term === null || term.trim() === '') {
      set({ activeTerm: null, highlightLocations: [] })
      return
    }
    set({ activeTerm: term })
    try {
      const { locations } = await searchApi.highlightAll(term, scope)
      set({ highlightLocations: locations })
    } catch {
      // highlight is best-effort; keep activeTerm so the overlay still marks the
      // current view, just without the cross-library location list.
    }
  },

  openTerm: async (termId) => {
    set({ activeTermDetail: null, termDetailLoading: true })
    try {
      const detail = await searchApi.termGet(termId)
      set({ activeTermDetail: detail, termDetailLoading: false })
    } catch (err) {
      set({ termDetailLoading: false })
      console.warn('[search] openTerm failed', err)
    }
  },

  closeTerm: () => set({ activeTermDetail: null, termDetailLoading: false }),

  openHit: (hit) => {
    useSessionStore.getState().openBookDetail(hit.bookId, hit.chapterId, hit.paragraphId)
  },
}))
