/**
 * BookDetailView — shell component for the open-book screen (v3.1 chapter-level
 * model). Wires the library store's fetch actions to useEffect
 * (tree → chapterContent), and composes the header + 3-column workspace
 * (ChapterTree / ReadingPane / AnalysisRail) + toast.
 *
 * Pure View: state and business logic live in useLibraryStore (Model);
 * sub-views are in components/page/library/.
 */
import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/models/shared/session'
import { useLibraryStore } from '@/models/library/store'
import { readingApi } from '@/models/library/api'
import { computeBookPercent, flattenChapters } from '@/models/library/helpers'
import type { BookListItem, ChapterNode } from '@/models/shared/types'
import { ChapterTree } from '@/components/page/library/ChapterTree'
import { ReadingPane } from '@/components/page/library/ReadingPane'
import { AnalysisRail } from '@/components/page/library/AnalysisRail'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'
import { Modal } from '@/components/interaction/Modal'

interface BookDetailViewProps {
  book: BookListItem
  targetChapterId: string | null
  onBack: () => void
  /** Called after a book title edit so the parent (LibraryView) can refresh its list. */
  onBookUpdated?: () => void
}

export function BookDetailView({ book, targetChapterId, onBack, onBookUpdated }: BookDetailViewProps) {
  const pendingMatchOffset = useSessionStore((s) => s.pendingMatchOffset)
  const setPendingMatchOffset = useSessionStore((s) => s.setPendingMatchOffset)

  const saveBookTitle = useLibraryStore((s) => s.saveBookTitle)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(book.title)
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [editingTitle])

  // keep the draft in sync if the book prop changes (e.g. after a parent refresh)
  useEffect(() => {
    if (!editingTitle) setTitleDraft(book.title)
  }, [book.title, editingTitle])

  const commitTitle = async () => {
    const t = titleDraft.trim()
    if (!t) {
      setEditingTitle(false)
      setTitleDraft(book.title)
      return
    }
    if (t === book.title) {
      setEditingTitle(false)
      return
    }
    try {
      await saveBookTitle(book.id, t)
      onBookUpdated?.()
    } catch {
      setTitleDraft(book.title)
    } finally {
      setEditingTitle(false)
    }
  }

  const fetchTree = useLibraryStore((s) => s.fetchTree)
  const tree = useLibraryStore((s) => s.tree)
  const selectedChapterId = useLibraryStore((s) => s.selectedChapterId)
  const fetchChapterContent = useLibraryStore((s) => s.fetchChapterContent)

  const excerptDeleteTarget = useLibraryStore((s) => s.excerptDeleteTarget)
  const setExcerptDeleteTarget = useLibraryStore((s) => s.setExcerptDeleteTarget)
  const deleteExcerpt = useLibraryStore((s) => s.deleteExcerpt)

  // D6: notes editor + delete confirm
  const noteEditor = useLibraryStore((s) => s.noteEditor)
  const setNoteDraft = useLibraryStore((s) => s.setNoteDraft)
  const closeNoteEditor = useLibraryStore((s) => s.closeNoteEditor)
  const createNoteFromEditor = useLibraryStore((s) => s.createNoteFromEditor)
  const noteDeleteTarget = useLibraryStore((s) => s.noteDeleteTarget)
  const setNoteDeleteTarget = useLibraryStore((s) => s.setNoteDeleteTarget)
  const deleteNote = useLibraryStore((s) => s.deleteNote)

  const toastMessage = useLibraryStore((s) => s.toastMessage)

  // Load tree on book / targetChapterId change.
  useEffect(() => {
    void fetchTree(book.id, targetChapterId)
  }, [book.id, targetChapterId, fetchTree])

  // Load chapter content when selectedChapterId changes.
  useEffect(() => {
    if (!selectedChapterId) return
    void fetchChapterContent(book.id, selectedChapterId)
  }, [book.id, selectedChapterId, fetchChapterContent])

  // D5: load the chapter's chat thread alongside its content.
  const fetchChatThread = useLibraryStore((s) => s.fetchChatThread)
  useEffect(() => {
    if (!selectedChapterId) return
    void fetchChatThread(book.id, selectedChapterId)
  }, [book.id, selectedChapterId, fetchChatThread])

  // ---- Reading-progress persistence (chapter-level: scroll ratio + dwell) ----
  useReadingProgress({ bookId: book.id, tree, selectedChapterId })

  // If a search result set a pending match offset, scroll to it once the
  // chapter content is loaded, then clear the hint.
  useEffect(() => {
    if (pendingMatchOffset == null || !selectedChapterId) return
    const offset = pendingMatchOffset
    setPendingMatchOffset(null)
    // give the reading pane a tick to render before dispatching the locate event
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('textblock:locate', { detail: { start: offset, end: offset } }))
    }, 80)
  }, [pendingMatchOffset, selectedChapterId, setPendingMatchOffset])

  return (
    <div className="bookdetail">
      <header className="bookdetail__header">
        <button
          type="button"
          className="bookdetail__back"
          onClick={onBack}
          title="返回书库"
          aria-label="返回书库"
        />
        <div className="bookdetail__titleBlock">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="bookdetail__titleInput"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commitTitle()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setTitleDraft(book.title)
                  setEditingTitle(false)
                }
              }}
              onBlur={() => void commitTitle()}
            />
          ) : (
            <div className="bookdetail__titleRow">
              <h2 className="bookdetail__title">{book.title}</h2>
              <span
                className={
                  book.category === 'classic'
                    ? 'bookdetail__catBadge bookdetail__catBadge--classic'
                    : 'bookdetail__catBadge bookdetail__catBadge--modern'
                }
                title={book.category === 'classic' ? '古籍' : '现代书'}
              >
                {book.category === 'classic' ? '古籍' : '现代书'}
              </span>
              <button
                type="button"
                className="bookdetail__editBtn bookdetail__editBtn--title"
                aria-label="编辑书名"
                title="编辑书名"
                onClick={() => setEditingTitle(true)}
              >
                ✎
              </button>
            </div>
          )}
        </div>
        <div className="bookdetail__headerActions" />
      </header>

      <div className="bookdetail__workspace">
        <ChapterTree bookId={book.id} />
        <ReadingPane bookId={book.id} />
        <AnalysisRail book={book} />
      </div>

      <ConfirmModal
        open={excerptDeleteTarget !== null}
        title="删除摘录"
        message="删除这条摘录？此操作不可撤销。"
        confirmLabel="删除"
        onConfirm={() => {
          if (excerptDeleteTarget) void deleteExcerpt(excerptDeleteTarget.id)
        }}
        onCancel={() => setExcerptDeleteTarget(null)}
      />

      {noteEditor && (
        <Modal
          title="写笔记"
          onClose={closeNoteEditor}
          actions={
            <>
              <button type="button" className="bookdetail__btn" onClick={closeNoteEditor}>
                取消
              </button>
              <button
                type="button"
                className="bookdetail__primary"
                disabled={noteEditor.draft.trim() === ''}
                onClick={() => void createNoteFromEditor()}
              >
                保存
              </button>
            </>
          }
        >
          {noteEditor.quote && (
            <blockquote className="noteeditor__quote">{noteEditor.quote}</blockquote>
          )}
          <textarea
            className="noteeditor__textarea"
            value={noteEditor.draft}
            placeholder="写下你的理解、疑问或联想…"
            autoFocus
            rows={6}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
        </Modal>
      )}

      <ConfirmModal
        open={noteDeleteTarget !== null}
        title="删除笔记"
        message="删除这条笔记？此操作不可撤销。"
        confirmLabel="删除"
        onConfirm={() => {
          if (noteDeleteTarget) void deleteNote(noteDeleteTarget.id)
        }}
        onCancel={() => setNoteDeleteTarget(null)}
      />

      {toastMessage && (
        <div className="bookdetail__toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// useReadingProgress — chapter-level reading-progress tracking + persistence.
// ============================================================================

const PROGRESS_TICK_MS = 5_000 // accumulate dwell time every 5s
const PROGRESS_DEBOUNCE_MS = 2_000 // debounce saveProgress writes
const READING_SCROLL_SELECTOR = '.bookdetail__readingScroll'

interface UseReadingProgressArgs {
  bookId: string
  tree: ChapterNode[]
  selectedChapterId: string | null
}

/**
 * Tracks reading dwell time + the reading-pane scroll ratio and debounces a
 * saveProgress call. Refs hold the latest values so the tick / scroll listeners
 * bind once per mount. read_seconds is a delta accumulated main-side.
 */
function useReadingProgress(args: UseReadingProgressArgs): void {
  const { bookId, tree, selectedChapterId } = args

  const bookIdRef = useRef(bookId)
  const flatChaptersRef = useRef<{ id: string }[]>([])
  const selectedChapterIdRef = useRef(selectedChapterId)
  const scrollRatioRef = useRef(0)
  const lastDwellFlushRef = useRef<number>(Date.now())
  const accumulatedSecondsRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    bookIdRef.current = bookId
    flatChaptersRef.current = flattenChapters(tree).map((c) => ({ id: c.id }))
    selectedChapterIdRef.current = selectedChapterId
  })

  // reset the dwell clock when the chapter changes
  useEffect(() => {
    lastDwellFlushRef.current = Date.now()
    scrollRatioRef.current = 0
  }, [selectedChapterId])

  // tick: accumulate dwell + schedule a flush
  useEffect(() => {
    const interval = setInterval(() => {
      settleDwell()
      scheduleFlush()
    }, PROGRESS_TICK_MS)
    return () => clearInterval(interval)
  }, [])

  // scroll listener on the reading pane container
  useEffect(() => {
    const el = document.querySelector(READING_SCROLL_SELECTOR) as HTMLElement | null
    if (!el) return
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight
      scrollRatioRef.current = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0
      scheduleFlush()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [selectedChapterId])

  // tab-hide / unmount: flush the remainder
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushProgress()
    }
    const onBeforeUnload = () => flushProgress()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      flushProgress()
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  function settleDwell() {
    const now = Date.now()
    const deltaMs = now - lastDwellFlushRef.current
    lastDwellFlushRef.current = now
    if (deltaMs > 0) accumulatedSecondsRef.current += Math.floor(deltaMs / 1000)
  }

  function flushProgress() {
    settleDwell()
    const bookIdNow = bookIdRef.current
    const chapterId = selectedChapterIdRef.current
    const seconds = accumulatedSecondsRef.current
    if (!bookIdNow || !chapterId) return
    const percent = computeBookPercent({
      flatChapters: flatChaptersRef.current,
      selectedChapterId: chapterId,
      scrollRatio: scrollRatioRef.current,
    })
    void readingApi
      .saveProgress({
        bookId: bookIdNow,
        chapterId,
        scrollRatio: scrollRatioRef.current,
        readSeconds: seconds,
        percent,
      })
      .catch(() => {
        // best-effort
      })
    accumulatedSecondsRef.current = 0
  }

  function scheduleFlush() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      flushProgress()
    }, PROGRESS_DEBOUNCE_MS)
  }
}
