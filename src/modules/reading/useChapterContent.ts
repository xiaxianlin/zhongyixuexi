/**
 * useChapterContent (RD-02/03, 03-reading.md §7.2).
 *
 * Loads a chapter's paragraphs via reading:getChapter and syncs them into the
 * reading store. On open, restores the saved segment-level progress for the
 * book (reading:getProgress) and, if it points at this chapter, records the
 * restore target (paragraphId + ratio) so the scroller can snap to it once
 * layout settles. Returns a transient error string for surfacing in the UI.
 */
import { useEffect, useRef } from 'react'
import { readingApi } from '@/lib/reading-api'
import { useReadingStore } from './store'

export function useChapterContent(bookId: string, chapterId: string): void {
  const setChapter = useReadingStore((s) => s.setChapter)
  const setLoading = useReadingStore((s) => s.setLoading)
  const requestScrollTo = useReadingStore((s) => s.requestScrollTo)
  const setTopParagraph = useReadingStore((s) => s.setTopParagraph)
  const loadingRef = useRef(false)

  useEffect(() => {
    let alive = true
    loadingRef.current = true
    setLoading(true)

    void (async () => {
      try {
        // Fetch chapter content + the book's saved progress in parallel.
        const [content, progress] = await Promise.all([
          readingApi.getChapter(bookId, chapterId),
          readingApi.getProgress(bookId),
        ])
        if (!alive || !content) {
          if (alive) setLoading(false)
          return
        }
        setChapter(bookId, chapterId, content.chapter.title, content.paragraphs)

        // Restore position only if the saved progress is for THIS chapter and its
        // paragraph is still present (segment-edit hard-delete may have removed it).
        if (
          progress &&
          progress.chapter_id === chapterId &&
          content.paragraphs.some((p) => p.id === progress.paragraph_id)
        ) {
          setTopParagraph(progress.paragraph_id, progress.scroll_ratio)
          // Hand the restore target to the scroller; it resolves the pixel
          // offset once the paragraph DOM is measurable (resolveRestorePosition).
          requestScrollTo(progress.paragraph_id)
        }
      } catch {
        // best-effort: leave store empty; the panel renders an empty-state.
        if (alive) setLoading(false)
      } finally {
        loadingRef.current = false
      }
    })()

    return () => {
      alive = false
    }
  }, [bookId, chapterId, setChapter, setLoading, requestScrollTo, setTopParagraph])
}
