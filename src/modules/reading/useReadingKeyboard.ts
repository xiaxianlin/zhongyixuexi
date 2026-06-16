/**
 * useReadingKeyboard (RD-09, 03-reading.md §6.6).
 *
 * A lightweight, dependency-free keyboard layer bound to `window`. Maps the
 * command list from the design doc (翻段/翻章/同步滚动/沉浸/书签/Tab/主题/跳转).
 * macOS uses Cmd, Windows uses Ctrl (auto-detected). Single-letter bindings
 * (J/K) are disabled while an input/textarea/contentEditable is focused to
 * avoid swallowing typing.
 *
 * Commands that need data (current paragraph, chapter list) read from the
 * reading store; navigation across chapters delegates to the parent
 * ReadingWorkbench via the `onNavigateChapter` callback (previous/next).
 */
import { useEffect } from 'react'
import { useReadingStore } from './store'
import { useSessionStore } from '@/stores/session'

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

/** True when the active element is a text-input surface (skip single-letter keys). */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

export interface KeyboardNav {
  onPrevChapter: () => void
  onNextChapter: () => void
  onJumpPalette: () => void
}

export function useReadingKeyboard(nav: KeyboardNav): void {
  const paragraphs = useReadingStore((s) => s.paragraphs)
  const topParagraphId = useReadingStore((s) => s.topParagraphId)
  const requestScrollTo = useReadingStore((s) => s.requestScrollTo)
  const toggleSyncScroll = useReadingStore((s) => s.toggleSyncScroll)
  const toggleImmersive = useReadingStore((s) => s.toggleImmersive)
  const openTab = useReadingStore((s) => s.openTab)
  const closeTab = useReadingStore((s) => s.closeTab)
  const activeTabId = useReadingStore((s) => s.activeTabId)
  const tabs = useReadingStore((s) => s.tabs)
  const bookId = useReadingStore((s) => s.bookId)
  const chapterId = useReadingStore((s) => s.chapterId)
  const openChapter = useSessionStore((s) => s.openChapter)

  useEffect(() => {
    const mod = isMac ? 'metaKey' : 'ctrlKey'

    const onKey = (e: KeyboardEvent): void => {
      const m = e[mod] as boolean
      const typing = isTypingTarget(e.target)

      // Cmd/Ctrl+Shift+Left / Right — previous/next chapter.
      if (m && e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        nav.onPrevChapter()
        return
      }
      if (m && e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault()
        nav.onNextChapter()
        return
      }
      // Cmd/Ctrl+Shift+S — toggle sync scroll.
      if (m && e.shiftKey && (e.key === 'S' || e.key === 's')) {
        e.preventDefault()
        toggleSyncScroll()
        return
      }
      // Cmd/Ctrl+Shift+F or F11 — toggle immersive.
      if ((m && e.shiftKey && (e.key === 'F' || e.key === 'f')) || e.key === 'F11') {
        e.preventDefault()
        toggleImmersive()
        return
      }
      // Cmd/Ctrl+D — bookmark current segment (delegated to workbench via store flag).
      if (m && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault()
        // Signal the workbench to add a bookmark at topParagraphId.
        window.dispatchEvent(
          new CustomEvent('reading:addBookmarkAt', {
            detail: { paragraphId: topParagraphId },
          }),
        )
        return
      }
      // Cmd/Ctrl+T — new tab (open current book's first chapter, or a placeholder).
      if (m && (e.key === 'T' || e.key === 't')) {
        e.preventDefault()
        if (bookId) openTab(bookId, chapterId, '')
        return
      }
      // Cmd/Ctrl+W — close active tab.
      if (m && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault()
        if (activeTabId) closeTab(activeTabId)
        return
      }
      // Cmd/Ctrl+P or Cmd/Ctrl+K — jump palette.
      if (m && ((e.key === 'P' || e.key === 'p') || (e.key === 'K' || e.key === 'k'))) {
        e.preventDefault()
        nav.onJumpPalette()
        return
      }

      // Single-letter segment nav — only when NOT typing.
      if (typing) return
      // J / Cmd+Down — next segment; K / Cmd+Up — previous segment.
      if ((e.key === 'j' && !m) || (m && e.key === 'ArrowDown')) {
        if (m) e.preventDefault()
        const idx = paragraphs.findIndex((p) => p.id === topParagraphId)
        const next = paragraphs[Math.min(paragraphs.length - 1, idx + 1)]
        if (next) {
          requestScrollTo(next.id)
          openChapter(chapterId ?? '', next.id)
        }
        return
      }
      if ((e.key === 'k' && !m) || (m && e.key === 'ArrowUp')) {
        if (m) e.preventDefault()
        const idx = paragraphs.findIndex((p) => p.id === topParagraphId)
        const prev = paragraphs[Math.max(0, idx - 1)]
        if (prev) {
          requestScrollTo(prev.id)
          openChapter(chapterId ?? '', prev.id)
        }
        return
      }

      // Esc — exit immersive if active.
      if (e.key === 'Escape') {
        // handled by the immersive overlay's own button; no-op here.
      }
      void tabs
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    paragraphs,
    topParagraphId,
    requestScrollTo,
    toggleSyncScroll,
    toggleImmersive,
    openTab,
    closeTab,
    activeTabId,
    tabs,
    bookId,
    chapterId,
    openChapter,
    nav,
  ])
}
