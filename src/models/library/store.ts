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
import { libraryApi, readingApi, editingApi, excerptsApi, notesApi } from './api'
import { aiApi } from '@/models/ai/api'
import { aiSubCodeFrom } from '@/models/ai/api'
import type { AiThreadDTO, AiMessageDTO } from '@/models/ai/types'
import type { ChapterNode } from '@/models/shared/types'
import type { ChapterContentView, ExcerptDTO, NoteDTO } from './types'
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

  // notes (chapter + selection-bound)
  notesByChapter: NoteDTO[]
  noteDeleteTarget: NoteDTO | null
  /** Open note editor modal; carries the optional selection-driven quote. */
  noteEditor: { quote: string | null; draft: string } | null

  // chapter title editing (inline)
  editingChapterId: string | null
  chapterDraft: string

  // ai generation (chapter-level analysis)
  aiGenerating: boolean

  // D5: chapter-scoped chat
  chatThread: AiThreadDTO | null
  chatMessages: AiMessageDTO[]
  chatStreaming: boolean
  /** Pending quote from a selection (set by the 引用 toolbar button). */
  pendingQuote: string | null
  /** Active analysis-rail tab (lifted so the 引用 button can switch to chat). */
  activeRailTab: 'chat' | 'analysis' | 'explanation' | 'modern' | 'notes' | 'excerpts'

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
  // notes
  fetchNotesByChapter: (chapterId: string) => Promise<void>
  openNoteEditor: (quote: string | null) => void
  closeNoteEditor: () => void
  setNoteDraft: (text: string) => void
  createNoteFromEditor: () => Promise<void>
  deleteNote: (id: string) => Promise<void>
  setNoteDeleteTarget: (note: NoteDTO | null) => void
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
  // D4: chapter-level AI analysis
  analyzeChapter: (force?: boolean) => Promise<void>
  // D5: chapter-scoped chat
  fetchChatThread: (bookId: string, chapterId: string) => Promise<void>
  sendChatMessage: (content: string) => Promise<void>
  resetChatThread: () => Promise<void>
  setPendingQuote: (quote: string | null) => void
  setActiveRailTab: (tab: 'chat' | 'analysis' | 'explanation' | 'modern' | 'notes' | 'excerpts') => void
  /** Subscribe to streaming token deltas for a thread (called by ChatTab mount). */
  subscribeChatTokens: () => () => void
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

  notesByChapter: [],
  noteDeleteTarget: null,
  noteEditor: null,

  editingChapterId: null,
  chapterDraft: '',

  aiGenerating: false,

  // D5: chat
  chatThread: null,
  chatMessages: [],
  chatStreaming: false,
  pendingQuote: null,
  activeRailTab: 'chat',

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
      set({ chapterContent: null, excerpts: [], notesByChapter: [], selection: null })
      return
    }
    set({ chapterContentLoading: true, selection: null, excerpts: [], notesByChapter: [] })
    try {
      const [content, excerpts, notes] = await Promise.all([
        readingApi.getChapterContent(bookId, chapterId),
        excerptsApi.listByChapter(chapterId),
        notesApi.listByChapter(chapterId),
      ])
      set({
        chapterContent: content,
        excerpts,
        notesByChapter: notes,
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
      const [excerpts, notes] = await Promise.all([
        excerptsApi.listByChapter(chapterContent.chapter.id),
        notesApi.listByChapter(chapterContent.chapter.id),
      ])
      set({
        chapterContent: refreshed,
        excerpts,
        notesByChapter: notes,
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

  // ----- notes -----
  fetchNotesByChapter: async (chapterId) => {
    try {
      const notes = await notesApi.listByChapter(chapterId)
      set({ notesByChapter: notes })
    } catch {
      set({ notesByChapter: [] })
    }
  },

  openNoteEditor: (quote) =>
    set({ noteEditor: { quote, draft: '' }, selection: null }),

  closeNoteEditor: () => set({ noteEditor: null }),

  setNoteDraft: (text) =>
    set((s) => (s.noteEditor ? { noteEditor: { ...s.noteEditor, draft: text } } : {})),

  createNoteFromEditor: async () => {
    const { noteEditor, chapterContent } = get()
    if (!noteEditor || !chapterContent) return
    const content = noteEditor.draft.trim()
    if (!content) {
      get().showToast('笔记内容不能为空')
      return
    }
    try {
      await notesApi.create({
        chapter_id: chapterContent.chapter.id,
        content,
        quote_text: noteEditor.quote,
      })
      const notes = await notesApi.listByChapter(chapterContent.chapter.id)
      set({ notesByChapter: notes, noteEditor: null })
      get().showToast('已保存笔记')
    } catch (e) {
      get().showToast(`保存笔记失败：${(e as Error).message}`)
    }
  },

  deleteNote: async (id) => {
    const { chapterContent } = get()
    if (!chapterContent) return
    try {
      await notesApi.delete(id)
      const notes = await notesApi.listByChapter(chapterContent.chapter.id)
      set({ notesByChapter: notes, noteDeleteTarget: null })
    } catch (e) {
      get().showToast(`删除笔记失败：${(e as Error).message}`)
    }
  },

  setNoteDeleteTarget: (note) => set({ noteDeleteTarget: note }),

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

  // ----- D4: chapter-level AI analysis -----
  analyzeChapter: async (force = false) => {
    const { chapterContent } = get()
    if (!chapterContent) return
    set({ aiGenerating: true, toastMessage: '' })
    try {
      const result = await aiApi.analyzeChapter(chapterContent.chapter.id, { force })
      set({ chapterContent: { ...chapterContent, analysis: result.analysis } })
      get().showToast(result.fromCache ? '已从缓存恢复' : '已生成解读')
    } catch (e) {
      const subCode = aiSubCodeFrom(e)
      get().showToast(
        subCode === 'AI_KEY_NOT_CONFIGURED'
          ? '请先在设置中配置 AI API Key'
          : `AI 解读失败：${(e as Error).message}`,
      )
    } finally {
      set({ aiGenerating: false })
    }
  },

  // ----- D5: chapter-scoped chat -----
  fetchChatThread: async (bookId, chapterId) => {
    if (!chapterId) {
      set({ chatThread: null, chatMessages: [], pendingQuote: null })
      return
    }
    try {
      const thread = await aiApi.threadForChapter(bookId, chapterId)
      const messages = await aiApi.chatHistory(thread.id)
      set({ chatThread: thread, chatMessages: messages })
    } catch {
      set({ chatThread: null, chatMessages: [] })
    }
  },

  sendChatMessage: async (content) => {
    const { chatThread, chatStreaming } = get()
    if (!chatThread || chatStreaming) return
    const text = content.trim()
    if (!text) return

    // optimistic: append a placeholder user bubble + an empty assistant bubble
    const optimisticUser: AiMessageDTO = {
      id: `pending-user-${Date.now()}`,
      thread_id: chatThread.id,
      role: 'user',
      content: text,
      quote_text: get().pendingQuote,
      quote_start: null,
      quote_end: null,
      model: null,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      created_at: Date.now(),
    }
    const optimisticAssistant: AiMessageDTO = {
      id: `pending-assistant-${Date.now()}`,
      thread_id: chatThread.id,
      role: 'assistant',
      content: '',
      quote_text: null,
      quote_start: null,
      quote_end: null,
      model: null,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      created_at: Date.now() + 1,
    }
    set({
      chatMessages: [...get().chatMessages, optimisticUser, optimisticAssistant],
      chatStreaming: true,
      pendingQuote: null,
    })

    try {
      const result = await aiApi.sendChat({
        threadId: chatThread.id,
        content: text,
        quote: optimisticUser.quote_text,
      })
      // replace the two optimistic bubbles with the persisted ones
      set({
        chatMessages: [
          ...get().chatMessages.filter(
            (m) => m.id !== optimisticUser.id && m.id !== optimisticAssistant.id,
          ),
          result.userMessage,
          result.assistantMessage,
        ],
      })
    } catch (e) {
      // replace the empty assistant bubble with an error note
      const subCode = aiSubCodeFrom(e)
      const errText =
        subCode === 'AI_KEY_NOT_CONFIGURED'
          ? '请先在设置中配置 AI API Key'
          : `对话失败：${(e as Error).message}`
      set({
        chatMessages: get().chatMessages.map((m) =>
          m.id === optimisticAssistant.id ? { ...m, content: errText } : m,
        ),
      })
    } finally {
      set({ chatStreaming: false })
    }
  },

  resetChatThread: async () => {
    const { chatThread } = get()
    if (!chatThread) return
    try {
      await aiApi.resetThread(chatThread.id)
      set({ chatMessages: [] })
      get().showToast('已清空对话')
    } catch (e) {
      get().showToast(`清空对话失败：${(e as Error).message}`)
    }
  },

  setPendingQuote: (quote) => set({ pendingQuote: quote }),

  setActiveRailTab: (tab) => set({ activeRailTab: tab }),

  subscribeChatTokens: () => {
    // token deltas arrive as { threadId, delta }; append to the last assistant
    // bubble of the matching thread while streaming.
    const off = window.api.on('ai:chat:token', (payload: unknown) => {
      const { threadId, delta } = payload as { threadId: string; delta: string }
      const { chatThread, chatStreaming } = get()
      if (!chatThread || chatThread.id !== threadId || !chatStreaming) return
      set({
        chatMessages: get().chatMessages.map((m, i, arr) => {
          if (i !== arr.length - 1 || m.role !== 'assistant') return m
          return { ...m, content: m.content + delta }
        }),
      })
    })
    return off
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
