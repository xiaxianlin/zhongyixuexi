/**
 * Zustand store for the NOTE module (session/UI cache only).
 * Persisted data always lives in SQLite — this store caches the current
 * note list, the active note + draft content, backlinks/outlinks for the
 * active note, and the reading-sidebar paragraph notes (NOTE-05).
 *
 * Follows 00-architecture §6: stores hold session/UI cache only.
 */

import { create } from 'zustand'
import { notesApi } from '@/lib/notes-api'
import type {
  Note,
  NoteListItem,
  ParagraphNoteCard,
  NoteLink,
  Backlink,
  NotebookNode,
  Tag,
} from '@/modules/notes/types'

interface NotesStore {
  // List
  list: NoteListItem[]
  total: number
  loading: boolean
  refreshList: () => Promise<void>

  // Current note + editor
  currentId: string | null
  current: Note | null
  draft: string
  draftTitle: string
  saving: boolean
  saveTimer: ReturnType<typeof setTimeout> | null
  openNote: (id: string) => Promise<void>
  closeNote: () => void
  setDraft: (md: string) => void
  setDraftTitle: (title: string) => void
  saveDraft: () => Promise<void>

  // Backlinks + outlinks for current note
  backlinks: Backlink[]
  outlinks: NoteLink[]
  refreshLinks: () => Promise<void>

  // NOTE-05: paragraph sidebar note cards
  sidebarParagraphId: string | null
  sidebarNotes: ParagraphNoteCard[]
  loadSidebar: (paragraphId: string) => Promise<void>

  // Create
  createNote: (opts?: {
    title?: string
    content?: string
    paragraph_id?: string | null
    book_id?: string | null
    chapter_id?: string | null
  }) => Promise<Note | null>

  // Delete
  deleteNote: (id: string) => Promise<void>

  // Notebooks + tags (cached for sidebar)
  notebooks: NotebookNode[]
  tags: Tag[]
  refreshNotebooks: () => Promise<void>
  refreshTags: () => Promise<void>
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  list: [],
  total: 0,
  loading: false,

  currentId: null,
  current: null,
  draft: '',
  draftTitle: '',
  saving: false,
  saveTimer: null,

  backlinks: [],
  outlinks: [],

  sidebarParagraphId: null,
  sidebarNotes: [],

  notebooks: [],
  tags: [],

  refreshList: async () => {
    set({ loading: true })
    try {
      const res = await notesApi.list({ limit: 100 })
      set({ list: res.items, total: res.total })
    } finally {
      set({ loading: false })
    }
  },

  openNote: async (id) => {
    const note = await notesApi.get(id)
    if (!note) return
    set({
      currentId: id,
      current: note,
      draft: note.content,
      draftTitle: note.title,
    })
    // Load links in parallel.
    void get().refreshLinks()
  },

  closeNote: () => {
    // Flush any pending save.
    const timer = get().saveTimer
    if (timer) {
      clearTimeout(timer)
      void get().saveDraft()
    }
    set({
      currentId: null,
      current: null,
      draft: '',
      draftTitle: '',
      backlinks: [],
      outlinks: [],
    })
  },

  setDraft: (md) => {
    set({ draft: md })
    // Debounce save: 800ms after last keystroke.
    const existing = get().saveTimer
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      void get().saveDraft()
    }, 800)
    set({ saveTimer: timer })
  },

  setDraftTitle: (title) => {
    set({ draftTitle: title })
    const existing = get().saveTimer
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      void get().saveDraft()
    }, 800)
    set({ saveTimer: timer })
  },

  saveDraft: async () => {
    const { currentId, draft, draftTitle } = get()
    if (!currentId) return
    set({ saving: true, saveTimer: null })
    try {
      const updated = await notesApi.update({
        id: currentId,
        content: draft,
        title: draftTitle,
      })
      set({ current: updated })
      // Refresh outlinks after content change (backlinks may have shifted).
      void get().refreshLinks()
      // Update list item preview.
      void get().refreshList()
    } finally {
      set({ saving: false })
    }
  },

  refreshLinks: async () => {
    const { currentId } = get()
    if (!currentId) return
    const [outlinks, backlinks] = await Promise.all([
      notesApi.getOutlinks(currentId),
      notesApi.getBacklinks('note', currentId),
    ])
    set({ outlinks, backlinks })
  },

  loadSidebar: async (paragraphId) => {
    set({ sidebarParagraphId: paragraphId })
    const notes = await notesApi.getByParagraph(paragraphId)
    set({ sidebarNotes: notes })
  },

  createNote: async (opts) => {
    const note = await notesApi.create({
      title: opts?.title,
      content: opts?.content,
      paragraph_id: opts?.paragraph_id,
      book_id: opts?.book_id,
      chapter_id: opts?.chapter_id,
    })
    await get().openNote(note.id)
    void get().refreshList()
    if (opts?.paragraph_id) {
      void get().loadSidebar(opts.paragraph_id)
    }
    return note
  },

  deleteNote: async (id) => {
    await notesApi.delete(id)
    if (get().currentId === id) {
      get().closeNote()
    }
    await get().refreshList()
    const sp = get().sidebarParagraphId
    if (sp) void get().loadSidebar(sp)
  },

  refreshNotebooks: async () => {
    const notebooks = await notesApi.listNotebooks()
    set({ notebooks })
  },

  refreshTags: async () => {
    const tags = await notesApi.listTags('note')
    set({ tags })
  },
}))
