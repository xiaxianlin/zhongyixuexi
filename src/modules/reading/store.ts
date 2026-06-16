/**
 * Reading store (RD module session state, Zustand).
 *
 * Caches ONLY the current session: loaded chapter paragraphs, top visible
 * paragraph, panel layout, sync-scroll toggle, immersive mode, bookmark cache,
 * and the multi-tab list. Persisted data (progress, bookmarks) lives in SQLite
 * and is read/written via reading:* IPC — never persisted in this store
 * (00-architecture §6: no double source of truth).
 *
 * Layout presets are cached in-memory here for now (S2.1). A TODO marks where
 * the SET module's settings table will take over persistence (key
 * `reading.layout`) once Phase 4 lands.
 */
import { create } from 'zustand'
import type {
  ParagraphDTO,
  BookmarkDTO,
  ReadingLayout,
  ReadingTab,
} from './types'

const DEFAULT_LAYOUT: ReadingLayout = {
  original: { visible: true, widthRatio: 0.34 },
  interpret: { visible: true, widthRatio: 0.4 },
  resource: { visible: true, widthRatio: 0.26, mode: 'resource' },
  syncScroll: true,
  fontSize: 20,
  lineHeight: 1.7,
}

interface ReadingState {
  // Tabs (RD-10).
  tabs: ReadingTab[]
  activeTabId: string | null

  // Active chapter content.
  bookId: string | null
  chapterId: string | null
  chapterTitle: string | null
  paragraphs: ParagraphDTO[]
  loading: boolean

  // Reading position (session cache; persisted via saveProgress on debounce).
  topParagraphId: string | null
  scrollRatio: number

  // Layout / UI.
  layout: ReadingLayout
  immersive: boolean

  // Bookmark cache (current book).
  bookmarks: BookmarkDTO[]

  // Pending scroll-to target (set by SRH cross-module jump or tab restore).
  pendingScrollParagraphId: string | null

  // -------- actions --------
  openTab: (bookId: string, chapterId: string | null, title: string) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  setChapter: (
    bookId: string,
    chapterId: string,
    title: string,
    paragraphs: ParagraphDTO[],
  ) => void
  setLoading: (loading: boolean) => void
  setTopParagraph: (id: string | null, ratio: number) => void
  setLayout: (patch: Partial<ReadingLayout>) => void
  setPanelRatio: (panel: 'original' | 'interpret' | 'resource', ratio: number) => void
  togglePanel: (panel: 'original' | 'interpret' | 'resource') => void
  toggleSyncScroll: () => void
  toggleImmersive: () => void
  setResourceMode: (mode: 'resource' | 'notes') => void
  setBookmarks: (bookmarks: BookmarkDTO[]) => void
  requestScrollTo: (paragraphId: string | null) => void
  reset: () => void
}

export const useReadingStore = create<ReadingState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  bookId: null,
  chapterId: null,
  chapterTitle: null,
  paragraphs: [],
  loading: false,

  topParagraphId: null,
  scrollRatio: 0,

  layout: DEFAULT_LAYOUT,
  immersive: false,

  bookmarks: [],

  pendingScrollParagraphId: null,

  openTab: (bookId, chapterId, title) => {
    // Reuse an existing tab for the same book+chapter (avoid duplicates).
    const existing = get().tabs.find(
      (t) => t.bookId === bookId && t.chapterId === chapterId,
    )
    if (existing) {
      set({ activeTabId: existing.id })
      return existing.id
    }
    const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const tab: ReadingTab = { id, bookId, chapterId, title }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }))
    return id
  },

  closeTab: (tabId) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return s
      const tabs = s.tabs.filter((t) => t.id !== tabId)
      let activeTabId = s.activeTabId
      if (activeTabId === tabId) {
        const next = tabs[Math.min(idx, tabs.length - 1)] ?? null
        activeTabId = next?.id ?? null
      }
      return { tabs, activeTabId }
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setChapter: (bookId, chapterId, title, paragraphs) =>
    set({
      bookId,
      chapterId,
      chapterTitle: title,
      paragraphs,
      topParagraphId: paragraphs[0]?.id ?? null,
      scrollRatio: 0,
      loading: false,
    }),

  setLoading: (loading) => set({ loading }),

  setTopParagraph: (id, ratio) => set({ topParagraphId: id, scrollRatio: ratio }),

  setLayout: (patch) => set((s) => ({ layout: { ...s.layout, ...patch } })),

  setPanelRatio: (panel, ratio) =>
    set((s) => {
      const clamped = Math.min(0.9, Math.max(0.1, ratio))
      return {
        layout: {
          ...s.layout,
          [panel]: { ...s.layout[panel], widthRatio: clamped },
        },
      }
    }),

  togglePanel: (panel) =>
    set((s) => {
      const cur = s.layout[panel]
      return {
        layout: { ...s.layout, [panel]: { ...cur, visible: !cur.visible } },
      }
    }),

  toggleSyncScroll: () =>
    set((s) => ({ layout: { ...s.layout, syncScroll: !s.layout.syncScroll } })),

  toggleImmersive: () => set((s) => ({ immersive: !s.immersive })),

  setResourceMode: (mode) =>
    set((s) => ({ layout: { ...s.layout, resource: { ...s.layout.resource, mode } } })),

  setBookmarks: (bookmarks) => set({ bookmarks }),

  requestScrollTo: (paragraphId) => set({ pendingScrollParagraphId: paragraphId }),

  reset: () =>
    set({
      bookId: null,
      chapterId: null,
      chapterTitle: null,
      paragraphs: [],
      loading: false,
      topParagraphId: null,
      scrollRatio: 0,
      bookmarks: [],
      pendingScrollParagraphId: null,
      // NOTE: layout / immersive / tabs are intentionally preserved across resets.
    }),
}))

export { DEFAULT_LAYOUT }
