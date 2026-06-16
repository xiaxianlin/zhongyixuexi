/**
 * Search store (SRH, Zustand). Session/UI cache only — persisted data lives in
 * SQLite (dictionary_terms). Holds the current query, results, the active
 * highlight term, and the term-popup detail. Jump-to-paragraph is delegated to
 * the session store (activeBookId/activeChapterId/activeParagraphId + view) so
 * the RD module owns rendering — see openHit().
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

  /** Jump to a search hit: sets session fields RD listens on, then view=reading. */
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
    // Cross-module contract (dev-rd / dev-srh): set the three session fields RD
    // consumes (activeBookId/activeChapterId/activeParagraphId), then switch
    // the top-level view to reading. SRH does NOT render the reader — RD picks
    // up activeParagraphId and scrolls to it. Setting all four fields in one
    // setState is deliberate: openChapter() does not set activeBookId, and a
    // search hit can target a different book than the currently open one.
    useSessionStore.setState({
      activeBookId: hit.bookId,
      activeChapterId: hit.chapterId,
      activeParagraphId: hit.paragraphId,
      view: 'reading',
    })
  },
}))
