/**
 * Library detail store (Zustand) — Model for the BookDetailView flow (v3.1
 * chapter-level model).
 *
 * Persisted data lives in SQLite; this store holds only session/UI cache for
 * the currently open book detail. Components read state and dispatch actions
 * from here; they do not call IPC directly.
 *
 * State groups:
 *  - tree: chapter tree + selected chapter
 *  - chapterContent: whole-chapter text + active analysis (reading pane)
 *  - selection: current text selection in the reading pane
 *  - excerpts: the current chapter's selection-anchored highlights
 *  - chapter content editing (textarea mode)
 *  - chapter title editing (inline)
 *  - toast
 */
import { create } from 'zustand'
import { libraryApi, readingApi, editingApi, excerptsApi } from './api'
import type { ChapterNode } from '@/models/shared/types'
import type { ChapterContentView, ExcerptDTO } from './types'
import { flattenChapters } from './helpers'
import type { ResolvedSelection } from '@/components/page/library/TextBlock'

const TOAST_TTL_MS = 3200

interface LibraryState {
  // tree
  tree: ChapterNode[]
  treeLoading: boolean
  selectedChapterId: string | null

  // chapter content (reading pane)
  chapterContent: ChapterContentView | null
  chapterContentLoading: boolean
  editingChapterContent: boolean
  chapterContentDraft: string

  // selection
  selection: ResolvedSelection | null

  // excerpts
  excerpts: ExcerptDTO[]
  excerptDeleteTarget: ExcerptDTO | null

  // chapter title editing (inline)
  editingChapterId: string | null
  chapterDraft: string

  // toast
  toastMessage: string

  // ----- actions -----
  fetchTree: (bookId: string, targetChapterId: string | null) => Promise<void>
  selectChapter: (chapterId: string) => void
  fetchChapterContent: (bookId: string, chapterId: string) => Promise<void>
  setSelection: (selection: ResolvedSelection | null) => void
  startEditChapterContent: () => void
  cancelEditChapterContent: () => void
  setChapterContentDraft: (text: string) => void
  saveChapterContent: () => Promise<void>
  createExcerptFromSelection: () => Promise<void>
  deleteExcerpt: (id: string) => Promise<void>
  setExcerptDeleteTarget: (excerpt: ExcerptDTO | null) => void
  locateExcerpt: (start: number, end: number) => void
  // chapter title editing
  startEditChapter: (chapterId: string, currentTitle: string) => void
  cancelEditChapter: () => void
  setChapterDraft: (title: string) => void
  saveChapterTitle: () => Promise<void>
  // chapter tree CRUD
  addChapter: (bookId: string, title: string) => Promise<void>
  addChildChapter: (bookId: string, parentId: string | null, title: string) => Promise<void>
  deleteChapter: (bookId: string, chapterId: string) => Promise<void>
  // book category
  setBookCategory: (bookId: string, category: 'classic' | 'modern') => Promise<boolean>
  // book title editing (LibraryView refreshes its own book list)
  saveBookTitle: (bookId: string, title: string) => Promise<{ id: string; title: string }>
  // create / delete — books (LibraryView refreshes its own book list)
  addBook: (title: string, author?: string) => Promise<{ id: string; title: string } | null>
  deleteBook: (bookId: string) => Promise<boolean>
  // toast
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

  chapterContent: null,
  chapterContentLoading: false,
  editingChapterContent: false,
  chapterContentDraft: '',

  selection: null,

  excerpts: [],
  excerptDeleteTarget: null,

  editingChapterId: null,
  chapterDraft: '',

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

  fetchChapterContent: async (bookId, chapterId) => {
    if (!chapterId) {
      set({ chapterContent: null, excerpts: [], selection: null })
      return
    }
    set({ chapterContentLoading: true, selection: null, excerpts: [] })
    try {
      const [content, excerpts] = await Promise.all([
        readingApi.getChapterContent(bookId, chapterId),
        excerptsApi.listByChapter(chapterId),
      ])
      set({
        chapterContent: content,
        excerpts,
        editingChapterContent: false,
        chapterContentDraft: content?.content ?? '',
      })
    } catch {
      set({ chapterContent: null })
    } finally {
      set({ chapterContentLoading: false })
    }
  },

  setSelection: (selection) => set({ selection }),

  startEditChapterContent: () => {
    const { chapterContent } = get()
    if (!chapterContent) return
    set({
      editingChapterContent: true,
      chapterContentDraft: chapterContent.content,
      selection: null,
    })
  },

  cancelEditChapterContent: () =>
    set({ editingChapterContent: false, chapterContentDraft: '' }),

  setChapterContentDraft: (text) => set({ chapterContentDraft: text }),

  saveChapterContent: async () => {
    const { chapterContent, chapterContentDraft } = get()
    if (!chapterContent) return
    set({ chapterContentLoading: true })
    try {
      const refreshed = await editingApi.saveChapterContent({
        id: chapterContent.chapter.id,
        text: chapterContentDraft,
      })
      const excerpts = await excerptsApi.listByChapter(chapterContent.chapter.id)
      set({
        chapterContent: refreshed,
        excerpts,
        editingChapterContent: false,
        chapterContentDraft: '',
      })
      get().showToast('已保存')
    } catch (e) {
      get().showToast(`保存失败：${(e as Error).message}`)
    } finally {
      set({ chapterContentLoading: false })
    }
  },

  createExcerptFromSelection: async () => {
    const { selection, chapterContent } = get()
    if (!selection || !chapterContent) return
    try {
      await excerptsApi.create({
        bookId: chapterContent.chapter.book_id,
        chapterId: chapterContent.chapter.id,
        start: selection.start,
        end: selection.end,
        text: selection.text,
      })
      const excerpts = await excerptsApi.listByChapter(chapterContent.chapter.id)
      set({ excerpts, selection: null })
      get().showToast('已摘录')
    } catch (e) {
      get().showToast(`摘录失败：${(e as Error).message}`)
    }
  },

  deleteExcerpt: async (id) => {
    const { chapterContent } = get()
    if (!chapterContent) return
    try {
      await excerptsApi.delete(id)
      const excerpts = await excerptsApi.listByChapter(chapterContent.chapter.id)
      set({ excerpts, excerptDeleteTarget: null })
    } catch (e) {
      get().showToast(`删除摘录失败：${(e as Error).message}`)
    }
  },

  setExcerptDeleteTarget: (excerpt) => set({ excerptDeleteTarget: excerpt }),

  locateExcerpt: (start, end) => {
    // signal the reading pane to scroll+flash this range
    window.dispatchEvent(new CustomEvent('textblock:locate', { detail: { start, end } }))
    set({ selection: { start, end, text: '' } })
  },

  // ----- chapter title editing -----
  startEditChapter: (chapterId, currentTitle) =>
    set({ editingChapterId: chapterId, chapterDraft: currentTitle }),

  cancelEditChapter: () => set({ editingChapterId: null, chapterDraft: '' }),

  setChapterDraft: (title) => set({ chapterDraft: title }),

  saveChapterTitle: async () => {
    const { editingChapterId, chapterDraft } = get()
    if (!editingChapterId) return
    const title = chapterDraft.trim()
    if (!title) {
      get().showToast('章节名不能为空')
      return
    }
    try {
      await editingApi.editChapterTitle({ id: editingChapterId, title })
      set((state) => ({
        tree: patchChapterTitle(state.tree, editingChapterId, title),
        editingChapterId: null,
        chapterDraft: '',
      }))
    } catch (e) {
      get().showToast(`章节重命名失败：${(e as Error).message}`)
    }
  },

  // ----- chapter tree CRUD -----
  addChapter: async (bookId, title) => {
    const t = title.trim()
    if (!t) {
      get().showToast('章节名不能为空')
      return
    }
    try {
      await editingApi.createChapter({ bookId, title: t })
      const nextTree = await libraryApi.tree(bookId)
      const flat = flattenChapters(nextTree)
      const last = flat[flat.length - 1] ?? null
      set({ tree: nextTree, selectedChapterId: last?.id ?? null })
      get().showToast('已新增章节')
    } catch (e) {
      get().showToast(`新增章节失败：${(e as Error).message}`)
    }
  },

  addChildChapter: async (bookId, parentId, title) => {
    const t = title.trim()
    if (!t) {
      get().showToast('章节名不能为空')
      return
    }
    try {
      const content = await editingApi.createChildChapter({ bookId, parentId, title: t })
      const nextTree = await libraryApi.tree(bookId)
      set({ tree: nextTree, selectedChapterId: content.chapter.id ?? null })
      get().showToast('已新增小节')
    } catch (e) {
      get().showToast(`新增小节失败：${(e as Error).message}`)
    }
  },

  deleteChapter: async (bookId, chapterId) => {
    try {
      await editingApi.deleteChapter({ id: chapterId })
      const nextTree = await libraryApi.tree(bookId)
      const first = nextTree[0] ?? null
      set({ tree: nextTree, selectedChapterId: first?.id ?? null, chapterContent: null })
      get().showToast('已删除章节')
    } catch (e) {
      get().showToast(`删除章节失败：${(e as Error).message}`)
    }
  },

  setBookCategory: async (bookId, category) => {
    try {
      await editingApi.setBookCategory({ id: bookId, category })
      get().showToast(category === 'classic' ? '已设为古籍' : '已设为现代书')
      return true
    } catch (e) {
      get().showToast(`分类切换失败：${(e as Error).message}`)
      return false
    }
  },

  // ----- book title editing -----
  saveBookTitle: async (bookId, title) => {
    const t = title.trim()
    if (!t) {
      get().showToast('书名不能为空')
      throw new Error('书名不能为空')
    }
    try {
      return await editingApi.editBookTitle({ id: bookId, title: t })
    } catch (e) {
      get().showToast(`书名保存失败：${(e as Error).message}`)
      throw e
    }
  },

  // ----- create / delete — books -----
  addBook: async (title, author) => {
    const t = title.trim()
    if (!t) {
      get().showToast('书名不能为空')
      return null
    }
    try {
      const created = await editingApi.createBook({ title: t, author })
      get().showToast(`已创建《${created.title}》`)
      return created
    } catch (e) {
      get().showToast(`创建书籍失败：${(e as Error).message}`)
      return null
    }
  },

  deleteBook: async (bookId) => {
    try {
      await editingApi.deleteBook({ id: bookId })
      get().showToast('已删除')
      return true
    } catch (e) {
      get().showToast(`删除书籍失败：${(e as Error).message}`)
      return false
    }
  },

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

/** Recursively patch a chapter's title in the tree (immutably). */
function patchChapterTitle(
  nodes: ChapterNode[],
  chapterId: string,
  title: string,
): ChapterNode[] {
  return nodes.map((n) =>
    n.id === chapterId
      ? { ...n, title }
      : { ...n, children: patchChapterTitle(n.children, chapterId, title) },
  )
}
