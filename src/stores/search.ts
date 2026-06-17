/**
 * Search store. Session/UI cache only. Jump-to-paragraph is delegated to the
 * library detail page via the session store.
 */

import { create } from 'zustand'
import { searchApi } from '@/lib/search-api'
import { useSessionStore } from '@/stores/session'
import type { SearchResult, SearchHit } from '@/lib/types'

interface SearchState {
  query: string
  result: SearchResult | null
  loading: boolean
  error: string | null

  runSearch: (q: string) => Promise<void>
  clear: () => void

  /** Jump to a search hit in the library detail page. */
  openHit: (hit: SearchHit) => void
}

export const useSearchStore = create<SearchState>((set) => ({
  query: '',
  result: null,
  loading: false,
  error: null,

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

  openHit: (hit) => {
    useSessionStore.getState().openBookDetail(hit.bookId, hit.chapterId, hit.paragraphId)
  },
}))
