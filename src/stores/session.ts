import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Session state for the currently focused paragraph (not part of the URL —
 * book/chapter routing is handled by react-router). Persisted so a refresh
 * restores the last paragraph selection.
 */
interface SessionState {
  activeParagraphId: string | null
  setActiveParagraph: (paragraphId: string | null) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      activeParagraphId: null,
      setActiveParagraph: (paragraphId) => set({ activeParagraphId: paragraphId }),
    }),
    {
      name: 'zyx-session',
      partialize: (s) => ({ activeParagraphId: s.activeParagraphId }),
    },
  ),
)
