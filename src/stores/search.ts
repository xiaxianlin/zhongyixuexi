/**
 * Search store. Session/UI cache only. Navigation is handled by the component
 * via react-router's useNavigate (store doesn't do routing).
 */

import { create } from 'zustand'
import { searchApi } from '@/lib/search-api'
import type { SearchResult } from '@/lib/types'

interface SearchState {
  query: string
  result: SearchResult | null
  loading: boolean
  error: string | null

  runSearch: (q: string) => Promise<void>
  clear: () => void
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
}))
