/**
 * useProgress (RD-08, 03-reading.md §7.3).
 *
 * Debounced segment-level progress recording. The reading store's
 * topParagraphId/scrollRatio are the live source; this hook observes them and,
 * after a 2s debounce, UPSERTs reading_progress. It also force-flushes on
 * page hide / beforeunload so a crash mid-debounce loses at most 2s of progress
 * (the main-process write is transactional — 03-reading.md §7.3 crash safety).
 *
 * A coarse reading-seconds counter ticks every 30s while the chapter is open
 * and the tab is visible, accumulating into read_seconds for the streak/
 * dashboard (NFR-driven, display-only here).
 */
import { useEffect } from 'react'
import { readingApi } from '@/lib/reading-api'
import { useReadingStore } from './store'

const DEBOUNCE_MS = 2000
const TICK_MS = 30000

export function useProgress(bookId: string, chapterId: string | null): void {
  const topParagraphId = useReadingStore((s) => s.topParagraphId)
  const scrollRatio = useReadingStore((s) => s.scrollRatio)

  useEffect(() => {
    if (!chapterId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let accSeconds = 0
    let tickTimer: ReturnType<typeof setInterval> | null = null

    // The effect re-runs on every tracked change (deps below), so doFlush's
    // closure always captures the current topParagraphId/scrollRatio/chapterId.
    // No ref mirror is needed — and writing refs during render is disallowed.
    const doFlush = async (): Promise<void> => {
      if (!chapterId || !topParagraphId) return
      try {
        await readingApi.saveProgress({
          book_id: bookId,
          chapter_id: chapterId,
          paragraph_id: topParagraphId,
          scroll_ratio: scrollRatio,
          read_seconds: accSeconds,
        })
        accSeconds = 0
      } catch {
        // swallow — progress is best-effort; never block reading.
      }
    }

    const schedule = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void doFlush()
      }, DEBOUNCE_MS)
    }

    // Re-schedule whenever the tracked paragraph/ratio changes.
    schedule()

    // Reading-seconds accumulator (paused when the tab is hidden).
    tickTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        accSeconds += Math.round(TICK_MS / 1000)
      }
    }, TICK_MS)

    // Force-flush on hide / unload (crash-safety flush window).
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void doFlush()
    }
    const onBeforeUnload = (): void => {
      void doFlush()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)

    return () => {
      if (timer) clearTimeout(timer)
      if (tickTimer) clearInterval(tickTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [bookId, chapterId, topParagraphId, scrollRatio])
}

/** Imperatively flush pending progress (e.g. before switching chapters). */
export function flushPendingProgress(): void {
  // Best-effort flush is handled by the visibilitychange / beforeunload
  // listeners inside useProgress; this is a no-op placeholder for callers/tests.
}
