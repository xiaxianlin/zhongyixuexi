/**
 * BookDetailView — shell component for the open-book screen. Wires the library
 * store's fetch actions to useEffect (tree → paragraphs → notes), and composes
 * the header + 3-column workspace + modals + toast from the page components.
 *
 * Pure View: state and business logic live in useLibraryStore (Model);
 * sub-views are in components/page/library/.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionStore } from '@/models/shared/session'
import { useLibraryStore } from '@/models/library/store'
import { readingApi } from '@/models/library/api'
import { computeBookPercent, flattenChapters } from '@/models/library/helpers'
import type { BookListItem, ChapterNode } from '@/models/shared/types'
import { ChapterList } from '@/components/page/library/ChapterList'
import { ParagraphList } from '@/components/page/library/ParagraphList'
import { InspectorPanel } from '@/components/page/library/InspectorPanel'
import { NoteDrawer } from '@/components/page/library/NoteDrawer'
import { NoteEditorModal } from '@/components/page/library/NoteEditorModal'
import { ParagraphEditModal } from '@/components/page/library/ParagraphEditModal'
import { MergePreviewModal } from '@/components/page/library/MergePreviewModal'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'

interface BookDetailViewProps {
  book: BookListItem
  targetChapterId: string | null
  onBack: () => void
  /** Called after a book title edit so the parent (LibraryView) can refresh its list. */
  onBookUpdated?: () => void
}

export function BookDetailView({ book, targetChapterId, onBack, onBookUpdated }: BookDetailViewProps) {
  const activeParagraphId = useSessionStore((s) => s.activeParagraphId)
  const targetParagraphId = activeParagraphId

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
  const fetchParagraphs = useLibraryStore((s) => s.fetchParagraphs)
  const selectedParagraphId = useLibraryStore((s) => s.selectedParagraphId)
  const fetchNotes = useLibraryStore((s) => s.fetchNotes)

  const notes = useLibraryStore((s) => s.notes)
  const notesLoading = useLibraryStore((s) => s.notesLoading)
  const paragraphs = useLibraryStore((s) => s.paragraphs)
  const setNoteModalOpen = useLibraryStore((s) => s.setNoteModalOpen)
  const setNoteDrawerOpen = useLibraryStore((s) => s.setNoteDrawerOpen)

  const deleteTarget = useLibraryStore((s) => s.deleteTarget)
  const deletingNote = useLibraryStore((s) => s.deletingNote)
  const setDeleteTarget = useLibraryStore((s) => s.setDeleteTarget)
  const deleteNote = useLibraryStore((s) => s.deleteNote)

  const reanalyzeConfirmOpen = useLibraryStore((s) => s.reanalyzeConfirmOpen)
  const setReanalyzeConfirmOpen = useLibraryStore((s) => s.setReanalyzeConfirmOpen)
  const aiGenerating = useLibraryStore((s) => s.aiGenerating)
  const runAnalysis = useLibraryStore((s) => s.runAnalysis)

  // paragraph batch-delete confirm
  const deleteConfirmOpen = useLibraryStore((s) => s.deleteConfirmOpen)
  const setDeleteConfirmOpen = useLibraryStore((s) => s.setDeleteConfirmOpen)
  const selectedParagraphIdsForDelete = useLibraryStore((s) => s.selectedParagraphIds)
  const confirmDeleteSelected = useLibraryStore((s) => s.confirmDeleteSelected)

  const toastMessage = useLibraryStore((s) => s.toastMessage)

  const selectedParagraph =
    paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? null

  // Load tree on book / targetChapterId change.
  useEffect(() => {
    void fetchTree(book.id, targetChapterId)
  }, [book.id, targetChapterId, fetchTree])

  // Load paragraphs when selectedChapterId changes (or targetParagraphId, which
  // may re-resolve against the same chapter).
  useEffect(() => {
    if (!selectedChapterId) return
    void fetchParagraphs(book.id, selectedChapterId, targetParagraphId)
  }, [book.id, selectedChapterId, targetParagraphId, fetchParagraphs])

  // Load notes when selectedParagraphId changes.
  useEffect(() => {
    void fetchNotes(selectedParagraphId)
  }, [selectedParagraphId, fetchNotes])

  // ---- Reading-progress persistence (RD-02) ----
  // While this book is open, accumulate the seconds the user dwells on the
  // selected paragraph, sample the paragraph-list scroll ratio, and debounce a
  // saveProgress call. The store state feeds computeBookPercent. read_seconds is
  // a delta accumulated main-side.
  useReadingProgress({
    bookId: book.id,
    tree,
    selectedChapterId,
    paragraphs,
    selectedParagraphId,
  })

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
        <div className="bookdetail__headerActions">
          <button
            type="button"
            className="bookdetail__noteCount"
            disabled={!selectedParagraph}
            onClick={() => setNoteDrawerOpen(true)}
          >
            {notesLoading ? '笔记加载中' : `${notes.length} 篇笔记`}
          </button>
          <button
            type="button"
            className="bookdetail__primary"
            disabled={!selectedParagraph}
            onClick={() => setNoteModalOpen(true)}
          >
            添加笔记
          </button>
        </div>
      </header>

      <div className="bookdetail__workspace">
        <ChapterList />
        <ParagraphList />
        <InspectorPanel />
      </div>

      <NoteDrawer />
      <NoteEditorModal bookId={book.id} chapterId={selectedChapterId} />

      <ConfirmModal
        open={deleteTarget !== null}
        title="确认删除"
        message="删除这篇笔记？此操作不可撤销。"
        confirmLabel="删除"
        busyLabel="删除中"
        busy={deletingNote}
        onConfirm={() => void deleteNote()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        open={reanalyzeConfirmOpen}
        title="重新分析"
        message="当前段落已有分析内容。重新分析会覆盖白话、医理和解读。"
        confirmLabel="确认覆盖"
        busy={aiGenerating}
        onConfirm={() => {
          setReanalyzeConfirmOpen(false)
          window.requestAnimationFrame(() => {
            void runAnalysis(true)
          })
        }}
        onCancel={() => setReanalyzeConfirmOpen(false)}
      />

      <ParagraphEditModal />
      <MergePreviewModal />

      <ConfirmModal
        open={deleteConfirmOpen}
        title="确认删除段落"
        message={`将删除 ${selectedParagraphIdsForDelete.length} 个段落，绑定笔记转为自由笔记。此操作不可撤销。`}
        confirmLabel="删除"
        busyLabel="删除中"
        onConfirm={() => void confirmDeleteSelected()}
        onCancel={() => setDeleteConfirmOpen(false)}
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
// useReadingProgress — RD-02 reading-progress tracking + persistence.
// ============================================================================

const PROGRESS_TICK_MS = 5_000 // accumulate dwell time every 5s
const PROGRESS_DEBOUNCE_MS = 2_000 // debounce saveProgress writes

/** Selector for the real scroll container (library.css: `.bookdetail__paragraphList`, overflow:auto). */
const PARAGRAPH_SCROLL_SELECTOR = '.bookdetail__paragraphList'

interface UseReadingProgressArgs {
  bookId: string
  tree: ChapterNode[]
  selectedChapterId: string | null
  paragraphs: ParagraphForPercent[]
  selectedParagraphId: string | null
}

type ParagraphForPercent = { id: string; order_index: number }

/**
 * Tracks reading dwell time + scroll ratio and debounces a saveProgress call.
 *
 * Refs hold the latest store values so the tick interval / scroll + visibility
 * listeners bind once per mount and always read current state. The dwell timer
 * accounts the elapsed seconds to the PREVIOUS paragraph whenever the selection
 * changes; a 5s tick flushes long dwells; tab-hide / unmount flush the
 * remainder. read_seconds is sent as a delta and accumulated main-side, so a
 * flush resets the local accumulator to 0.
 */
function useReadingProgress(args: UseReadingProgressArgs): void {
  const { bookId, tree, selectedChapterId, paragraphs, selectedParagraphId } = args

  // Latest-value refs (mirrored from props so the tick/listeners read current
  // state without re-binding). Synced in an effect — never written during render
  // (react-hooks/refs rule).
  const bookIdRef = useRef(bookId)
  const flatChaptersRef = useRef<{ id: string }[]>([])
  const selectedChapterIdRef = useRef(selectedChapterId)
  const paragraphsRef = useRef(paragraphs)
  const selectedParagraphIdRef = useRef(selectedParagraphId)

  useEffect(() => {
    bookIdRef.current = bookId
    flatChaptersRef.current = flattenChapters(tree).map((c) => ({ id: c.id }))
    selectedChapterIdRef.current = selectedChapterId
    paragraphsRef.current = paragraphs
    selectedParagraphIdRef.current = selectedParagraphId
  })

  // Mutable progress state.
  const scrollRatioRef = useRef(0)
  const accumulatedSecondsRef = useRef(0)
  const dwellStartRef = useRef<number | null>(null) // ms timestamp when current para dwell began
  const lastFlushedSigRef = useRef<string | null>(null) // dedup key: paraId + scrollBucket
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The progress callbacks are defined at module scope (stable identity, no
  // useCallback needed) and close over refs that hold the latest values, so the
  // tick/listener effects below can bind once per mount. `ctx` only contains
  // refs (stable identities), so memoizing it once keeps the effect deps stable.
  const ctx = useMemo<ProgressCtx>(
    () => ({
      bookIdRef,
      flatChaptersRef,
      selectedChapterIdRef,
      paragraphsRef,
      selectedParagraphIdRef,
      scrollRatioRef,
      accumulatedSecondsRef,
      dwellStartRef,
      lastFlushedSigRef,
      saveTimerRef,
    }),
    [],
  )

  // --- Paragraph-change settlement: when the selected paragraph changes,
  // account the prior dwell and (re)start the dwell clock for the new one.
  useEffect(() => {
    if (selectedParagraphId == null) {
      dwellStartRef.current = null
      return
    }
    settleDwell(ctx)
    dwellStartRef.current = Date.now()
    scheduleFlush(ctx)
  }, [selectedParagraphId, ctx])

  // --- Tick: every 5s settle dwell so long dwells flush even without selection
  // changes. Also re-schedules a debounced save (so active reading keeps writing).
  useEffect(() => {
    const interval = setInterval(() => {
      settleDwell(ctx)
      scheduleFlush(ctx)
    }, PROGRESS_TICK_MS)
    return () => clearInterval(interval)
  }, [ctx])

  // --- Scroll listener on the paragraph-list container. Re-resolves the element
  // when paragraphs change (the container is conditionally rendered per chapter).
  useEffect(() => {
    const el = document.querySelector(PARAGRAPH_SCROLL_SELECTOR) as HTMLElement | null
    if (!el) return
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight
      scrollRatioRef.current = max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0
      scheduleFlush(ctx)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [paragraphs, ctx])

  // --- Tab-hide / unmount: flush the remainder so seconds aren't lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushProgress(ctx)
    }
    const onBeforeUnload = () => flushProgress(ctx)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      flushProgress(ctx)
      if (ctx.saveTimerRef.current) clearTimeout(ctx.saveTimerRef.current)
    }
  }, [ctx])
}

// ============================================================================
// Module-scope progress helpers (stable identity; close over the refs in `ctx`).
// Defined outside the hook so they never change identity and the tick/listener
// effects bind once per mount.
// ============================================================================

interface ProgressCtx {
  bookIdRef: React.MutableRefObject<string>
  flatChaptersRef: React.MutableRefObject<{ id: string }[]>
  selectedChapterIdRef: React.MutableRefObject<string | null>
  paragraphsRef: React.MutableRefObject<ParagraphForPercent[]>
  selectedParagraphIdRef: React.MutableRefObject<string | null>
  scrollRatioRef: React.MutableRefObject<number>
  accumulatedSecondsRef: React.MutableRefObject<number>
  dwellStartRef: React.MutableRefObject<number | null>
  lastFlushedSigRef: React.MutableRefObject<string | null>
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
}

/** Account elapsed dwell onto the accumulator and reset the dwell clock. */
function settleDwell(ctx: ProgressCtx): void {
  if (ctx.dwellStartRef.current == null) return
  const deltaMs = Date.now() - ctx.dwellStartRef.current
  ctx.dwellStartRef.current = Date.now() // restart the clock for the next window
  if (deltaMs > 0) {
    ctx.accumulatedSecondsRef.current += Math.floor(deltaMs / 1000)
  }
}

/** Flush: settle dwell → write the accumulated delta + current position → reset. */
function flushProgress(ctx: ProgressCtx): void {
  settleDwell(ctx)
  const paraId = ctx.selectedParagraphIdRef.current
  const bookIdNow = ctx.bookIdRef.current
  const chapterId = ctx.selectedChapterIdRef.current
  const seconds = ctx.accumulatedSecondsRef.current
  if (!bookIdNow || !chapterId || !paraId) return

  // Dedup: skip when nothing changed since the last write for this paragraph
  // (no new seconds, same paragraph, same scroll bucket) — avoids idle writes
  // every 2s while the user sits still.
  const scrollBucket = Math.round(ctx.scrollRatioRef.current * 100) // 0..100
  const sig = `${paraId}:${scrollBucket}:${seconds}`
  if (seconds === 0 && sig === ctx.lastFlushedSigRef.current) return

  const percent = computeBookPercent({
    flatChapters: ctx.flatChaptersRef.current,
    selectedChapterId: chapterId,
    paragraphs: ctx.paragraphsRef.current,
    selectedParagraphId: paraId,
  })
  void readingApi
    .saveProgress({
      bookId: bookIdNow,
      chapterId,
      paragraphId: paraId,
      scrollRatio: ctx.scrollRatioRef.current,
      readSeconds: seconds,
      percent,
    })
    .catch(() => {
      // Swallow — progress is best-effort; a failed save must not disrupt reading.
    })
  ctx.accumulatedSecondsRef.current = 0
  ctx.lastFlushedSigRef.current = sig
}

/** Schedule (or re-schedule) a debounced flush. */
function scheduleFlush(ctx: ProgressCtx): void {
  if (ctx.saveTimerRef.current) clearTimeout(ctx.saveTimerRef.current)
  ctx.saveTimerRef.current = setTimeout(() => {
    ctx.saveTimerRef.current = null
    flushProgress(ctx)
  }, PROGRESS_DEBOUNCE_MS)
}
