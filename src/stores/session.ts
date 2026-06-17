import { create } from 'zustand'

export type View = 'home' | 'library' | 'settings' | 'search'

/**
 * Cross-module shared session state (00-architecture §6): the book/chapter/
 * paragraph currently in focus, plus the active top-level view. Persisted
 * data still lives in SQLite; this store is a session cache only.
 */
interface SessionState {
  view: View
  activeBookId: string | null
  activeChapterId: string | null
  activeParagraphId: string | null
  setView: (view: View) => void
  openBookDetail: (bookId: string, chapterId?: string | null, paragraphId?: string | null) => void
  clearBookTarget: () => void
  setActiveParagraph: (paragraphId: string | null) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  view: 'home',
  activeBookId: null,
  activeChapterId: null,
  activeParagraphId: null,
  setView: (view) => set({ view }),
  openBookDetail: (bookId, chapterId = null, paragraphId = null) =>
    set({ activeBookId: bookId, activeChapterId: chapterId, activeParagraphId: paragraphId, view: 'library' }),
  clearBookTarget: () =>
    set({ activeBookId: null, activeChapterId: null, activeParagraphId: null }),
  setActiveParagraph: (paragraphId) => set({ activeParagraphId: paragraphId }),
}))
