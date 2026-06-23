/**
 * ReadingPane — middle column of BookDetailView (v3.1).
 *
 * Renders the whole-chapter plain text (chapter.content) with a serif reading
 * layout. The user can select any substring → a floating toolbar offers
 * 摘录 / 写笔记 / 引用. The header has 「AI 分析」(placeholder until D4) and
 * 「编辑」(toggles a textarea that saves via chapters:saveContent, re-anchoring
 * excerpts + selection-bound notes).
 *
 * Replaces ParagraphList for the reading path; the legacy paragraph edit / merge
 * / split flows remain available via their modals but the reading surface is now
 * chapter-level.
 */
import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '@/models/library/store'
import { useAiStore } from '@/models/ai/store'
import { TextBlock, getOffsetsFromSelection, type HighlightRange } from './TextBlock'
import { SelectionToolbar } from './SelectionToolbar'

export function ReadingPane({ bookId }: { bookId: string }) {
  const selectedChapterId = useLibraryStore((s) => s.selectedChapterId)
  const chapterContent = useLibraryStore((s) => s.chapterContent)
  const loading = useLibraryStore((s) => s.chapterContentLoading)
  const fetchChapterContent = useLibraryStore((s) => s.fetchChapterContent)
  const editing = useLibraryStore((s) => s.editingChapterContent)
  const draft = useLibraryStore((s) => s.chapterContentDraft)
  const startEdit = useLibraryStore((s) => s.startEditChapterContent)
  const cancelEdit = useLibraryStore((s) => s.cancelEditChapterContent)
  const setDraft = useLibraryStore((s) => s.setChapterContentDraft)
  const saveContent = useLibraryStore((s) => s.saveChapterContent)
  const selection = useLibraryStore((s) => s.selection)
  const setSelection = useLibraryStore((s) => s.setSelection)
  const excerpts = useLibraryStore((s) => s.excerpts)
  const notes = useLibraryStore((s) => s.notesByChapter)
  const createExcerpt = useLibraryStore((s) => s.createExcerptFromSelection)
  const aiGenerating = useLibraryStore((s) => s.aiGenerating)
  const analyzeChapter = useLibraryStore((s) => s.analyzeChapter)
  const setPendingQuote = useLibraryStore((s) => s.setPendingQuote)
  const setActiveRailTab = useLibraryStore((s) => s.setActiveRailTab)
  const openNoteEditor = useLibraryStore((s) => s.openNoteEditor)
  const aiConfigured = useAiStore((s) => s.status?.configured ?? false)

  const textRef = useRef<HTMLDivElement | null>(null)
  const [toolbarRect, setToolbarRect] = useState<DOMRect | null>(null)

  // Load the chapter content whenever the selection changes.
  useEffect(() => {
    if (selectedChapterId) void fetchChapterContent(bookId, selectedChapterId)
  }, [bookId, selectedChapterId, fetchChapterContent])

  // Listen for locate events (excerpt card click → scroll + flash).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { start: number; end: number }
      flashRange(textRef.current, detail.start, detail.end)
    }
    window.addEventListener('textblock:locate', handler)
    return () => window.removeEventListener('textblock:locate', handler)
  }, [])

  const onMouseUp = () => {
    if (editing) return
    const resolved = getOffsetsFromSelection(textRef.current)
    setSelection(resolved)
    if (resolved) {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        setToolbarRect(sel.getRangeAt(0).getBoundingClientRect())
      }
    } else {
      setToolbarRect(null)
    }
  }

  const ranges: HighlightRange[] = [
    ...excerpts
      .filter((e) => !e.stale)
      .map((e) => ({ start: e.start_offset, end: e.end_offset, kind: 'excerpt' as const })),
    ...notes
      .filter((n) => !n.stale && n.start_offset != null && n.end_offset != null)
      .map((n) => ({
        start: n.start_offset!,
        end: n.end_offset!,
        kind: 'note' as const,
      })),
  ]

  const analyzed = Boolean(chapterContent?.analysis.meta)

  return (
    <section className="bookdetail__paragraphs bookdetail__reading" aria-label="阅读">
      <div className="bookdetail__railHead bookdetail__readingHead">
        <span className="bookdetail__readingTitle">
          {chapterContent?.chapter.title ?? '阅读'}
        </span>
        <div className="bookdetail__readingActions">
          <button
            type="button"
            className={
              aiGenerating
                ? 'bookdetail__analyzeBtn bookdetail__analyzeBtn--loading'
                : 'bookdetail__analyzeBtn'
            }
            disabled={!chapterContent || loading || aiGenerating}
            title={analyzed ? '重新生成本章解读' : '生成本章 AI 解读'}
            onClick={() => void analyzeChapter(true)}
          >
            {aiGenerating ? '分析中…' : analyzed ? '重新分析' : 'AI 分析'}
          </button>
          {editing ? (
            <>
              <button
                type="button"
                className="bookdetail__btn"
                onClick={cancelEdit}
                disabled={loading}
              >
                取消
              </button>
              <button
                type="button"
                className="bookdetail__primary"
                onClick={() => void saveContent()}
                disabled={loading}
              >
                {loading ? '保存中' : '保存'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bookdetail__editBtn bookdetail__editBtn--para"
              aria-label="编辑正文"
              title="编辑正文"
              disabled={!chapterContent}
              onClick={startEdit}
            >
              ✎
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bookdetail__paragraphList bookdetail__readingScroll" aria-label="加载正文">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--text" style={{ width: '92%' }} />
          <span className="skeleton skeleton--text" style={{ width: '88%' }} />
          <span className="skeleton skeleton--text" style={{ width: '95%' }} />
          <span className="skeleton skeleton--text" style={{ width: '70%' }} />
          <span className="skeleton skeleton--text" style={{ width: '90%' }} />
        </div>
      ) : !chapterContent ? (
        <p className="bookdetail__empty">无正文</p>
      ) : editing ? (
        <textarea
          className="bookdetail__contentEdit"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancelEdit()
            }
          }}
        />
      ) : (
        <div className="bookdetail__paragraphList bookdetail__readingScroll" onMouseUp={onMouseUp}>
          <TextBlock content={chapterContent.content} ranges={ranges} containerRef={textRef} />
        </div>
      )}

      <SelectionToolbar
        selection={selection}
        rect={toolbarRect}
        quoteEnabled={aiConfigured}
        onExcerpt={() => void createExcerpt()}
        onNote={(sel) => {
          openNoteEditor(sel.text)
          setSelection(null)
          setToolbarRect(null)
        }}
        onQuote={(sel) => {
          setPendingQuote(sel.text)
          setActiveRailTab('chat')
          setSelection(null)
          setToolbarRect(null)
        }}
      />
    </section>
  )
}

/** Briefly highlight a range by re-selecting it in the DOM and scrolling into view. */
function flashRange(container: HTMLElement | null, start: number, end: number): void {
  if (!container) return
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let n = walker.nextNode() as Text | null
  while (n) {
    nodes.push(n)
    n = walker.nextNode() as Text | null
  }
  let offset = 0
  let startNode: Text | null = null
  let startOff = 0
  let endNode: Text | null = null
  let endOff = 0
  for (const tn of nodes) {
    const len = tn.nodeValue?.length ?? 0
    if (!startNode && offset + len >= start) {
      startNode = tn
      startOff = start - offset
    }
    if (offset + len >= end) {
      endNode = tn
      endOff = end - offset
      break
    }
    offset += len
  }
  if (!startNode || !endNode) return
  const range = document.createRange()
  range.setStart(startNode, startOff)
  range.setEnd(endNode, endOff)
  startNode.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}
