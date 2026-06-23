import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Session state for cross-view navigation hints (not part of the URL —
 * book/chapter routing is handled by react-router).
 *
 * v3.1 chapter-level model: search results jump to a chapter and optionally
 * scroll to a match offset within chapters.content. `pendingMatchOffset` is a
 * one-shot hint consumed by the reading pane on mount, then cleared.
 *
 * Session/UI cache only; persisted data lives in SQLite.
 */
interface SessionState {
  /** One-shot: code-point offset to scroll to when the target chapter opens. */
  pendingMatchOffset: number | null
  setPendingMatchOffset: (offset: number | null) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      pendingMatchOffset: null,
      setPendingMatchOffset: (offset) => set({ pendingMatchOffset: offset }),
    }),
    {
      name: 'zyx-session',
      partialize: () => ({}), // one-shot hint — do not persist across reloads
    },
  ),
)
