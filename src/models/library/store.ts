/**
 * Library detail store (Zustand) — Model for the BookDetailView flow.
 *
 * Per project rule: persisted data always lives in SQLite; this store holds
 * only session/UI cache for the currently open book detail. Components read
 * state and dispatch actions from here; they do not call IPC directly.
 *
 * The store is keyed by the current bookId + targetChapterId + targetParagraphId
 * (the latter comes from useSessionStore.activeParagraphId). The view layer
 * wires useEffect to the fetch actions (fetchTree / fetchParagraphs / fetchNotes),
 * mirroring the original BookDetail effect dependency chain.
 */
import { create } from 'zustand'
import { libraryApi, readingApi, notesApi } from './api'
import { aiApi } from '@/models/ai/api'
import { aiSubCodeFrom } from '@/models/ai/api'
import type { ChapterNode } from '@/models/shared/types'
import type { ParagraphDTO, ParagraphNoteCard } from './types'
import { compactAnalysisText, flattenChapters } from './helpers'

const TOAST_TTL_MS = 3200
const AI_MIN_SPINNER_MS = 450

interface LibraryState {
  // tree
  tree: ChapterNode[]
  treeLoading: boolean
  selectedChapterId: string | null

  // paragraphs
  paragraphs: ParagraphDTO[]
  contentLoading: boolean
  selectedParagraphId: string | null

  // notes
  notes: ParagraphNoteCard[]
  notesLoading: boolean
  noteDrawerOpen: boolean

  // note editor
  noteDraftContent: string
  noteSaving: boolean
  noteModalOpen: boolean

  // delete confirm
  deleteTarget: ParagraphNoteCard | null
  deletingNote: boolean

  // ai
  aiGenerating: boolean
  reanalyzeConfirmOpen: boolean

  // toast
  toastMessage: string

  // ----- actions -----
  fetchTree: (bookId: string, targetChapterId: string | null) => Promise<void>
  selectChapter: (chapterId: string) => void
  fetchParagraphs: (
    bookId: string,
    chapterId: string,
    targetParagraphId: string | null,
  ) => Promise<void>
  selectParagraph: (paragraphId: string) => void
  fetchNotes: (paragraphId: string | null) => Promise<void>
  runAnalysis: (force?: boolean) => Promise<void>
  requestAnalysis: () => void
  createParagraphNote: (bookId: string, chapterId: string) => Promise<void>
  deleteNote: () => Promise<void>
  setNoteDraftContent: (content: string) => void
  setNoteModalOpen: (open: boolean) => void
  setNoteDrawerOpen: (open: boolean) => void
  setDeleteTarget: (note: ParagraphNoteCard | null) => void
  setReanalyzeConfirmOpen: (open: boolean) => void
  showToast: (message: string) => void
  clearToast: () => void
}

let toastTimer: number | null = null

function scheduleToastClear(set: (partial: Partial<LibraryState>) => void) {
  if (toastTimer !== null) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    set({ toastMessage: '' })
    toastTimer = null
  }, TOAST_TTL_MS)
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tree: [],
  treeLoading: true,
  selectedChapterId: null,

  paragraphs: [],
  contentLoading: false,
  selectedParagraphId: null,

  notes: [],
  notesLoading: false,
  noteDrawerOpen: false,

  noteDraftContent: '',
  noteSaving: false,
  noteModalOpen: false,

  deleteTarget: null,
  deletingNote: false,

  aiGenerating: false,
  reanalyzeConfirmOpen: false,

  toastMessage: '',

  fetchTree: async (bookId, targetChapterId) => {
    set({ treeLoading: true, tree: [], toastMessage: '' })
    try {
      const nextTree = await libraryApi.tree(bookId)
      const targetChapter = targetChapterId
        ? flattenChapters(nextTree).find((chapter) => chapter.id === targetChapterId)
        : null
      const firstChapter = targetChapter ?? nextTree[0] ?? null
      set({ tree: nextTree, selectedChapterId: firstChapter?.id ?? null })
    } catch {
      set({ tree: [] })
    } finally {
      set({ treeLoading: false })
    }
  },

  selectChapter: (chapterId) => {
    set({ selectedChapterId: chapterId })
  },

  fetchParagraphs: async (bookId, chapterId, targetParagraphId) => {
    if (!chapterId) {
      set({ paragraphs: [], selectedParagraphId: null })
      return
    }
    set({
      contentLoading: true,
      selectedParagraphId: null,
      notes: [],
      noteDrawerOpen: false,
      toastMessage: '',
    })
    try {
      const content = await readingApi.getChapter(bookId, chapterId)
      const nextParagraphs = content?.paragraphs ?? []
      const targetParagraph = targetParagraphId
        ? nextParagraphs.find((paragraph) => paragraph.id === targetParagraphId)
        : null
      set({
        paragraphs: nextParagraphs,
        selectedParagraphId: targetParagraph?.id ?? nextParagraphs[0]?.id ?? null,
      })
    } catch {
      set({ paragraphs: [] })
    } finally {
      set({ contentLoading: false })
    }
  },

  selectParagraph: (paragraphId) => {
    set({ selectedParagraphId: paragraphId })
  },

  fetchNotes: async (paragraphId) => {
    if (!paragraphId) {
      set({ notes: [], noteDrawerOpen: false })
      return
    }
    set({ notesLoading: true })
    try {
      const nextNotes = await notesApi.getByParagraph(paragraphId)
      set({ notes: nextNotes })
    } catch (e) {
      get().showToast(`笔记加载失败：${(e as Error).message}`)
    } finally {
      set({ notesLoading: false })
    }
  },

  runAnalysis: async (force = false) => {
    const { selectedParagraphId } = get()
    if (!selectedParagraphId) return
    const startedAt = Date.now()
    set({ aiGenerating: true, toastMessage: '' })
    try {
      const result = await aiApi.generateModern(selectedParagraphId, { force })
      const interpretation = {
        modern: compactAnalysisText(result.interpretation.modern ?? ''),
        explanation: compactAnalysisText(result.interpretation.explanation ?? ''),
        analysis: compactAnalysisText(result.interpretation.analysis ?? ''),
        meta: result.interpretation.meta,
      }
      set((state) => ({
        paragraphs: state.paragraphs.map((paragraph) =>
          paragraph.id === selectedParagraphId ? { ...paragraph, interpretation } : paragraph,
        ),
      }))
    } catch (e) {
      const subCode = aiSubCodeFrom(e)
      get().showToast(
        subCode === 'AI_KEY_NOT_CONFIGURED'
          ? '请先在设置中配置 AI API Key'
          : `AI 解读失败：${(e as Error).message}`,
      )
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < AI_MIN_SPINNER_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, AI_MIN_SPINNER_MS - elapsed))
      }
      set({ aiGenerating: false })
    }
  },

  requestAnalysis: () => {
    const { selectedParagraphId, paragraphs } = get()
    if (!selectedParagraphId) return
    const selected = paragraphs.find((p) => p.id === selectedParagraphId) ?? null
    const analyzed = Boolean(selected?.interpretation?.meta)
    if (analyzed) {
      set({ reanalyzeConfirmOpen: true })
      return
    }
    void get().runAnalysis(true)
  },

  createParagraphNote: async (bookId, chapterId) => {
    const { selectedParagraphId, noteDraftContent } = get()
    if (!selectedParagraphId) return
    const content = noteDraftContent.trim()
    if (!content) {
      get().showToast('先写一点笔记内容')
      return
    }
    set({ noteSaving: true, toastMessage: '' })
    try {
      await notesApi.create({
        book_id: bookId,
        chapter_id: chapterId,
        paragraph_id: selectedParagraphId,
        content,
      })
      set({
        noteDraftContent: '',
        noteModalOpen: false,
        noteDrawerOpen: true,
        notes: await notesApi.getByParagraph(selectedParagraphId),
      })
    } catch (e) {
      get().showToast(`笔记保存失败：${(e as Error).message}`)
    } finally {
      set({ noteSaving: false })
    }
  },

  deleteNote: async () => {
    const { deleteTarget, selectedParagraphId } = get()
    if (!deleteTarget || !selectedParagraphId) return
    set({ deletingNote: true, toastMessage: '' })
    try {
      await notesApi.delete(deleteTarget.id)
      set({ deleteTarget: null, notes: await notesApi.getByParagraph(selectedParagraphId) })
    } catch (e) {
      get().showToast(`删除失败：${(e as Error).message}`)
    } finally {
      set({ deletingNote: false })
    }
  },

  setNoteDraftContent: (noteDraftContent) => set({ noteDraftContent }),

  setNoteModalOpen: (noteModalOpen) => set({ noteModalOpen }),

  setNoteDrawerOpen: (noteDrawerOpen) => set({ noteDrawerOpen }),

  setDeleteTarget: (deleteTarget) => set({ deleteTarget }),

  setReanalyzeConfirmOpen: (reanalyzeConfirmOpen) => set({ reanalyzeConfirmOpen }),

  showToast: (message) => {
    scheduleToastClear(set)
    set({ toastMessage: message })
  },

  clearToast: () => {
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer)
      toastTimer = null
    }
    set({ toastMessage: '' })
  },
}))
