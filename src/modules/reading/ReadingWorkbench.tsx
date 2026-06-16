/**
 * ReadingWorkbench — the three-column reading workbench root (RD-01..RD-10).
 *
 * Composes:
 *  - a toolbar (chapter title, prev/next chapter, sync-scroll toggle, immersive
 *    toggle, theme cycle, layout presets selector, tab bar) (RD-01/RD-07/RD-09/RD-10)
 *  - three panels in a draggable splitter: OriginalPanel / InterpretPanel /
 *    ResourcePanel (RD-01). Each panel can be collapsed (single panel fills).
 *  - the sync-scroll controller (useSyncScroll) wired to the original & interpret
 *    scroll containers (RD-03).
 *  - progress recording (useProgress) and chapter loading (useChapterContent)
 *    (RD-02/RD-08).
 *  - the keyboard layer (useReadingKeyboard) (RD-09).
 *  - the term popover (RD-05).
 *
 * Cross-module contract (dev-srh): this component subscribes to the session
 * store's activeBookId/activeChapterId/activeParagraphId. SRH (and any other
 * module) sets those three fields + view='reading' to drive the reader — when
 * activeParagraphId changes we hand it to the store's requestScrollTo so
 * useSyncScroll scrolls the original column to that segment (and, if sync is on,
 * propagates to the interpret column).
 *
 * Layout persistence (S2.1): width ratios + visibility live in the in-memory
 * reading store for now. A TODO marks where the SET module's settings table
 * (key `reading.layout`) takes over persistence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { libraryApi } from '@/lib/ipc'
import { readingApi } from '@/lib/reading-api'
import { useSessionStore } from '@/stores/session'
import { useReadingStore } from './store'
import { useChapterContent } from './useChapterContent'
import { useProgress } from './useProgress'
import { useSyncScroll } from './useSyncScroll'
import { useReadingKeyboard } from './useReadingKeyboard'
import { OriginalPanel, type TermPopoverTarget } from './OriginalPanel'
import { InterpretPanel } from './InterpretPanel'
import { ResourcePanel } from './ResourcePanel'
import { TermPopover } from './TermPopover'
import type { ChapterNode } from '@/lib/types'
import './reading.css'

interface ReadingWorkbenchProps {
  bookId: string
  /** The chapter to open; null shows a "select a chapter" placeholder. */
  initialChapterId?: string | null
}

export function ReadingWorkbench({
  bookId,
  initialChapterId = null,
}: ReadingWorkbenchProps): React.ReactElement {
  // ---------- chapter tree (for prev/next + jump palette) ----------
  const [tree, setTree] = useState<ChapterNode[]>([])
  useEffect(() => {
    let alive = true
    libraryApi
      .tree(bookId)
      .then((t) => {
        if (alive) setTree(t)
      })
      .catch(() => {
        if (alive) setTree([])
      })
    return () => {
      alive = false
    }
  }, [bookId])

  // Flatten the tree to an ordered leaf list (chapters with no children are the
  // readable units; navigation moves among leaves).
  const flatChapters = useMemo(() => flattenLeaves(tree), [tree])

  // ---------- chapter selection (driven by props OR session store) ----------
  const [chapterId, setChapterId] = useState<string | null>(initialChapterId)

  // Seed from session store on mount (SRH may have set activeChapterId).
  const sessionChapterId = useSessionChapter(bookId)
  useEffect(() => {
    if (chapterId == null && sessionChapterId) {
      setChapterId(sessionChapterId)
    }
  }, [sessionChapterId, chapterId])

  // ---------- store wiring ----------
  const layout = useReadingStore((s) => s.layout)
  const immersive = useReadingStore((s) => s.immersive)
  const paragraphs = useReadingStore((s) => s.paragraphs)
  const chapterTitle = useReadingStore((s) => s.chapterTitle)
  const setPanelRatio = useReadingStore((s) => s.setPanelRatio)
  const togglePanel = useReadingStore((s) => s.togglePanel)
  const toggleSyncScroll = useReadingStore((s) => s.toggleSyncScroll)
  const toggleImmersive = useReadingStore((s) => s.toggleImmersive)
  const openTab = useReadingStore((s) => s.openTab)
  const tabs = useReadingStore((s) => s.tabs)
  const activeTabId = useReadingStore((s) => s.activeTabId)
  const setActiveTab = useReadingStore((s) => s.setActiveTab)
  const closeTab = useReadingStore((s) => s.closeTab)
  const requestScrollTo = useReadingStore((s) => s.requestScrollTo)

  // Load chapter content + restore progress.
  useChapterContent(bookId, chapterId ?? '')
  // Record progress (debounced) while a chapter is open.
  useProgress(bookId, chapterId)

  // ---------- scroll container refs (shared with useSyncScroll) ----------
  const originalRef = useRef<HTMLDivElement>(null)
  const interpretRef = useRef<HTMLDivElement>(null)
  useSyncScroll(originalRef, interpretRef)

  // ---------- term popover (RD-05) ----------
  const [termTarget, setTermTarget] = useState<TermPopoverTarget | null>(null)

  // ---------- SRH cross-module jump ----------
  // When the session store's activeParagraphId changes (e.g. a search hit was
  // opened), ensure the right chapter is loaded and scroll to the paragraph.
  const jumpParagraphId = useSessionParagraph(bookId)
  useEffect(() => {
    if (!jumpParagraphId) return
    // The paragraph may belong to a different chapter than the one open; if the
    // current chapter doesn't contain it, we can't resolve the chapter from here
    // without an extra query. The session store setter (SRH) is expected to also
    // set activeChapterId; useSessionChapter surfaces it.
    if (chapterId) requestScrollTo(jumpParagraphId)
  }, [jumpParagraphId, chapterId, requestScrollTo])

  // ---------- keyboard (RD-09) ----------
  // Declare these BEFORE the nav useMemo so the closures capture initialized
  // bindings (avoiding TDZ on the const setters).
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteFilter, setPaletteFilter] = useState('')

  const navigateChapter = useCallback(
    (dir: -1 | 1): void => {
      if (flatChapters.length === 0) return
      const idx = chapterId ? flatChapters.findIndex((c) => c.id === chapterId) : -1
      const nextIdx =
        idx < 0
          ? dir > 0
            ? 0
            : flatChapters.length - 1
          : Math.min(flatChapters.length - 1, Math.max(0, idx + dir))
      const next = flatChapters[nextIdx]
      if (next) setChapterId(next.id)
    },
    [flatChapters, chapterId],
  )

  const nav = useMemo(
    () => ({
      onPrevChapter: () => navigateChapter(-1),
      onNextChapter: () => navigateChapter(1),
      onJumpPalette: () => setPaletteOpen((v) => !v),
    }),
    [navigateChapter],
  )
  useReadingKeyboard(nav)

  // ---------- bookmark-at-current-segment event (from keyboard Cmd+D) ----------
  useEffect(() => {
    const handler = async (e: Event): Promise<void> => {
      const detail = (e as CustomEvent).detail as { paragraphId: string | null }
      if (!chapterId || !detail?.paragraphId) return
      try {
        await readingApi.addBookmark({
          book_id: bookId,
          chapter_id: chapterId,
          paragraph_id: detail.paragraphId,
        })
        const bms = await readingApi.listBookmarks(bookId)
        useReadingStore.getState().setBookmarks(bms)
      } catch {
        // best-effort
      }
    }
    window.addEventListener('reading:addBookmarkAt', handler as EventListener)
    return () => window.removeEventListener('reading:addBookmarkAt', handler as EventListener)
  }, [bookId, chapterId])

  const onSelectChapter = useCallback(
    (id: string): void => {
      setChapterId(id)
      const node = flatChapters.find((c) => c.id === id)
      openTab(bookId, id, node?.title ?? '')
      setPaletteOpen(false)
    },
    [flatChapters, openTab, bookId],
  )

  // ---------- drag splitter (RD-01) ----------
  // A single horizontal drag gesture resizes two adjacent panels. We track which
  // gap is being dragged and redistribute the width delta between the two
  // neighbouring panels (preserving their sum so the row doesn't overflow).
  const workbenchRef = useRef<HTMLDivElement>(null)
  const [dragGap, setDragGap] = useState<null | { left: keyof Panels; right: keyof Panels }>(null)

  useEffect(() => {
    if (!dragGap) return
    const onMove = (e: MouseEvent): void => {
      const wb = workbenchRef.current
      if (!wb) return
      const rect = wb.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width // 0..1 within the row
      const panels = useReadingStore.getState().layout
      const { left, right } = dragGap
      const leftRatio = panels[left].widthRatio
      const rightRatio = panels[right].widthRatio
      const pairSum = leftRatio + rightRatio
      // New left ratio clamped so neither shrinks below 0.1.
      const newLeft = Math.min(pairSum - 0.1, Math.max(0.1, x - panelOffsetBefore(panels, left)))
      const newRight = pairSum - newLeft
      setPanelRatio(left, newLeft)
      setPanelRatio(right, newRight)
    }
    const onUp = (): void => setDragGap(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragGap, setPanelRatio])

  const visiblePanels = useMemo(() => {
    const ps: Panels = {
      original: layout.original,
      interpret: layout.interpret,
      resource: layout.resource,
    }
    return ps
  }, [layout])

  return (
    <div
      className={`rwb${immersive ? ' rwb--immersive' : ''}`}
      ref={workbenchRef}
    >
      {/* ---------- toolbar ---------- */}
      {!immersive && (
        <header className="rwb__toolbar">
          <div className="rwb__titlewrap">
            <h2 className="rwb__title">{chapterTitle ?? '阅读'}</h2>
            <div className="rwb__nav">
              <button
                type="button"
                className="rwb__iconbtn"
                onClick={() => navigateChapter(-1)}
                disabled={flatChapters.length === 0}
                title="上一章 (Cmd+Shift+←)"
                aria-label="上一章"
              >
                ‹
              </button>
              <button
                type="button"
                className="rwb__iconbtn"
                onClick={() => navigateChapter(1)}
                disabled={flatChapters.length === 0}
                title="下一章 (Cmd+Shift+→)"
                aria-label="下一章"
              >
                ›
              </button>
            </div>
          </div>

          <div className="rwb__controls">
            <button
              type="button"
              className={`rwb__btn${layout.syncScroll ? ' rwb__btn--on' : ''}`}
              onClick={toggleSyncScroll}
              title="逐段锁定同步滚动 (Cmd+Shift+S)"
            >
              同步
            </button>
            <button
              type="button"
              className="rwb__btn"
              onClick={() => setPaletteOpen(true)}
              title="跳转 (Cmd+P)"
            >
              跳转
            </button>
            <button
              type="button"
              className="rwb__btn"
              onClick={toggleImmersive}
              title="沉浸模式 (F11)"
            >
              沉浸
            </button>
            {/* Panel visibility toggles */}
            <button
              type="button"
              className={`rwb__btn${layout.original.visible ? ' rwb__btn--on' : ''}`}
              onClick={() => togglePanel('original')}
              title="显示/隐藏原文栏"
            >
              原
            </button>
            <button
              type="button"
              className={`rwb__btn${layout.interpret.visible ? ' rwb__btn--on' : ''}`}
              onClick={() => togglePanel('interpret')}
              title="显示/隐藏解读栏"
            >
              解
            </button>
            <button
              type="button"
              className={`rwb__btn${layout.resource.visible ? ' rwb__btn--on' : ''}`}
              onClick={() => togglePanel('resource')}
              title="显示/隐藏资源栏"
            >
              资
            </button>
          </div>
        </header>
      )}

      {/* ---------- tab bar (RD-10) ---------- */}
      {!immersive && tabs.length > 0 && (
        <div className="rwb__tabs">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`rwb__tab${t.id === activeTabId ? ' rwb__tab--active' : ''}`}
            >
              <button
                type="button"
                className="rwb__tablabel"
                onClick={() => {
                  setActiveTab(t.id)
                  if (t.chapterId) setChapterId(t.chapterId)
                }}
              >
                {t.title || '(未命名)'}
              </button>
              <button
                type="button"
                className="rwb__tabclose"
                onClick={() => closeTab(t.id)}
                aria-label="关闭标签"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ---------- three columns ---------- */}
      <div className="rwb__body">
        {!chapterId ? (
          <div className="rwb__placeholder">
            <p>从「跳转」或书签中选择一章开始阅读。</p>
            <button type="button" className="rwb__btn" onClick={() => setPaletteOpen(true)}>
              打开目录
            </button>
          </div>
        ) : (
          <div className="rwb__cols">
            {layout.original.visible && (
              <>
                <div
                  className="rwb__col"
                  style={{ flex: `${visiblePanels.original.widthRatio} 1 0` }}
                >
                  <OriginalPanel
                    ref={originalRef}
                    paragraphs={paragraphs}
                    onTerm={(tgt) => setTermTarget(tgt)}
                  />
                </div>
                <div
                  className="rwb__splitter"
                  role="separator"
                  aria-orientation="vertical"
                  onMouseDown={() => setDragGap({ left: 'original', right: 'interpret' })}
                />
              </>
            )}
            {layout.interpret.visible && (
              <>
                <div
                  className="rwb__col"
                  style={{ flex: `${visiblePanels.interpret.widthRatio} 1 0` }}
                >
                  <InterpretPanel ref={interpretRef} paragraphs={paragraphs} />
                </div>
                {layout.resource.visible && (
                  <div
                    className="rwb__splitter"
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={() => setDragGap({ left: 'interpret', right: 'resource' })}
                  />
                )}
              </>
            )}
            {layout.resource.visible && (
              <div
                className="rwb__col"
                style={{ flex: `${visiblePanels.resource.widthRatio} 1 0` }}
              >
                <ResourcePanel
                  onJumpParagraph={(cid, pid) => {
                    setChapterId(cid)
                    if (pid) requestScrollTo(pid)
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- immersive exit button ---------- */}
      {immersive && (
        <button
          type="button"
          className="rwb__exitimmersive"
          onClick={toggleImmersive}
          title="退出沉浸 (F11 / Esc)"
        >
          退出沉浸
        </button>
      )}

      {/* ---------- jump palette (RD-09) ---------- */}
      {paletteOpen && (
        <div className="rwb__palette-overlay" onClick={() => setPaletteOpen(false)}>
          <div className="rwb__palette" onClick={(e) => e.stopPropagation()}>
            <input
              className="rwb__palette-input"
              autoFocus
              placeholder="输入章节名筛选…"
              onChange={(e) => setPaletteFilter(e.target.value)}
            />
            <ul className="rwb__palette-list">
              {flatChapters
                .filter((c) =>
                  paletteFilter === ''
                    ? true
                    : c.title.includes(paletteFilter),
                )
                .map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="rwb__palette-item"
                      onClick={() => onSelectChapter(c.id)}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}

      {/* ---------- term popover (RD-05) ---------- */}
      <TermPopover target={termTarget} onClose={() => setTermTarget(null)} />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type Panels = {
  original: { visible: boolean; widthRatio: number }
  interpret: { visible: boolean; widthRatio: number }
  resource: { visible: boolean; widthRatio: number }
}

/** Sum of widthRatios of panels ordered before `name`. */
function panelOffsetBefore(panels: Panels, name: keyof Panels): number {
  const order: (keyof Panels)[] = ['original', 'interpret', 'resource']
  let acc = 0
  for (const k of order) {
    if (k === name) break
    acc += panels[k].widthRatio
  }
  return acc
}

/** Flatten the chapter tree to its readable leaves (deepest nodes). */
function flattenLeaves(nodes: ChapterNode[]): ChapterNode[] {
  const out: ChapterNode[] = []
  const walk = (ns: ChapterNode[]): void => {
    for (const n of ns) {
      if (n.children.length > 0) walk(n.children)
      else out.push(n)
    }
  }
  walk(nodes)
  return out
}

/**
 * Subscribe to the session store's activeChapterId for THIS book. Returns the
 * chapter id when it belongs to the currently open book (so a SRH jump that
 * targets a different book still updates activeBookId at the App route level,
 * and this hook then fires when the new ReadingWorkbench mounts).
 */
function useSessionChapter(bookId: string): string | null {
  const activeBookId = useSessionStore((s) => s.activeBookId)
  const activeChapterId = useSessionStore((s) => s.activeChapterId)
  return activeBookId === bookId ? activeChapterId : null
}

/** Subscribe to activeParagraphId for this book (SRH cross-module jump target). */
function useSessionParagraph(bookId: string): string | null {
  const activeBookId = useSessionStore((s) => s.activeBookId)
  const activeParagraphId = useSessionStore((s) => s.activeParagraphId)
  return activeBookId === bookId ? activeParagraphId : null
}
