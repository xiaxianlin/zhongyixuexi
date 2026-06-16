import { create } from 'zustand'

export type View = 'library' | 'reading' | 'review' | 'notes' | 'settings' | 'search'

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
  openBook: (bookId: string) => void
  openChapter: (chapterId: string, paragraphId?: string | null) => void
  setActiveParagraph: (paragraphId: string | null) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  view: 'library',
  activeBookId: null,
  activeChapterId: null,
  activeParagraphId: null,
  setView: (view) => set({ view }),
  openBook: (bookId) =>
    set({ activeBookId: bookId, activeChapterId: null, activeParagraphId: null, view: 'reading' }),
  openChapter: (chapterId, paragraphId = null) =>
    set({ activeChapterId: chapterId, activeParagraphId: paragraphId }),
  setActiveParagraph: (paragraphId) => set({ activeParagraphId: paragraphId }),
}))
