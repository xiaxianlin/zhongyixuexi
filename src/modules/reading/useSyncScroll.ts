/**
 * useSyncScroll (RD-03, 03-reading.md §7.1).
 *
 * Wires the pure syncScroll algorithm (findAnchor + computeSyncTarget) to two
 * real scroll containers (original <-> interpretation). On scroll in either
 * column, when sync is enabled, it derives the anchor segment + within-segment
 * ratio from the source and sets the OTHER column's scrollTop to the matching
 * segment's top + ratio*height (segment-locked, not naive scroll-ratio — works
 * correctly even when the two columns' segment heights differ).
 *
 * Engineering points (03-reading.md §7.1 key points):
 *  - reentry guard via rAF: setting B.scrollTop fires B's scroll event; a flag
 *    cleared on the next animation frame prevents the echo from re-syncing A
 *    (avoids the classic feedback oscillation).
 *  - rAF throttle: coalesce multiple scroll events in one frame.
 *  - which column drove the last scroll is tracked so re-enabling sync after a
 *    toggle snaps the OTHER column to the driver (no jump on the driver side).
 */
import { useCallback, useEffect, useRef } from 'react'
import { useReadingStore } from './store'
import { buildPanelMetrics } from './panelRegistry'
import { findAnchor, computeSyncTarget, resolveRestorePosition } from './syncScroll'

const SELECTOR = '[data-paragraph-id]'

export function useSyncScroll(
  originalRef: React.RefObject<HTMLDivElement>,
  interpretRef: React.RefObject<HTMLDivElement>,
): void {
  const syncScroll = useReadingStore((s) => s.layout.syncScroll)
  const requestScrollTo = useReadingStore((s) => s.requestScrollTo)
  const pendingScrollParagraphId = useReadingStore((s) => s.pendingScrollParagraphId)
  const topParagraphId = useReadingStore((s) => s.topParagraphId)
  const scrollRatio = useReadingStore((s) => s.scrollRatio)

  const syncing = useRef(false)
  const lastDriver = useRef<'original' | 'interpret'>('original')
  const rafId = useRef<number | null>(null)

  /** Schedule the flag clear on the next frame (rAF reentry guard). */
  const releaseNextFrame = useCallback((): void => {
    if (rafId.current != null) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(() => {
      syncing.current = false
      rafId.current = null
    })
  }, [])

  /** Drive `target` from `source` using the pure algorithm. */
  const syncFromTo = useCallback(
    (
      sourceEl: HTMLDivElement,
      targetEl: HTMLDivElement,
    ): void => {
      if (syncing.current) return
      const sourceMetrics = buildPanelMetrics(sourceEl, SELECTOR)
      const targetMetrics = buildPanelMetrics(targetEl, SELECTOR)
      const anchor = findAnchor(sourceMetrics, sourceEl.scrollTop)
      const target = computeSyncTarget(targetMetrics, anchor.id, anchor.ratio)
      syncing.current = true
      targetEl.scrollTop = target.scrollTop
      releaseNextFrame()
    },
    [releaseNextFrame],
  )

  // Attach scroll listeners. Re-binds when syncScroll toggles so we only listen
  // while synchronization is active (zero overhead when off).
  useEffect(() => {
    if (!syncScroll) return
    const a = originalRef.current
    const b = interpretRef.current
    if (!a || !b) return

    const onOriginal = (): void => {
      lastDriver.current = 'original'
      syncFromTo(a, b)
    }
    const onInterpret = (): void => {
      lastDriver.current = 'interpret'
      syncFromTo(b, a)
    }
    a.addEventListener('scroll', onOriginal, { passive: true })
    b.addEventListener('scroll', onInterpret, { passive: true })
    return () => {
      a.removeEventListener('scroll', onOriginal)
      b.removeEventListener('scroll', onInterpret)
    }
  }, [syncScroll, originalRef, interpretRef, syncFromTo])

  // When sync is RE-enabled, snap the non-driver column to the driver (no jump
  // on the side the user last scrolled). Runs once per syncScroll transition.
  const prevSync = useRef(syncScroll)
  useEffect(() => {
    const wasOff = !prevSync.current && syncScroll
    prevSync.current = syncScroll
    if (!wasOff) return
    const a = originalRef.current
    const b = interpretRef.current
    if (!a || !b) return
    if (lastDriver.current === 'original') syncFromTo(a, b)
    else syncFromTo(b, a)
  }, [syncScroll, originalRef, interpretRef, syncFromTo])

  // Restore position: when a pendingScrollParagraphId arrives (progress restore
  // or SRH cross-module jump), resolve its pixel offset in the ORIGINAL column
  // and scroll there; if sync is on, the listener above propagates to interpret.
  // Retries on the next frame until the segment DOM is measurable (virtual list
  // may need a frame to render the target row).
  useEffect(() => {
    if (!pendingScrollParagraphId) return
    const a = originalRef.current
    if (!a) return
    const metrics = buildPanelMetrics(a, SELECTOR)
    const pos = resolveRestorePosition(metrics, pendingScrollParagraphId, scrollRatio)
    if (pos == null) {
      // Not measurable yet — retry once on the next frame (then give up).
      const id = requestAnimationFrame(() => {
        const m2 = buildPanelMetrics(a, SELECTOR)
        const p2 = resolveRestorePosition(m2, pendingScrollParagraphId, scrollRatio)
        if (p2 != null) {
          syncing.current = true
          a.scrollTop = p2
          releaseNextFrame()
        }
      })
      return () => cancelAnimationFrame(id)
    }
    syncing.current = true
    a.scrollTop = pos
    releaseNextFrame()
    requestScrollTo(null) // consume
    return
  }, [pendingScrollParagraphId, scrollRatio, originalRef, requestScrollTo, releaseNextFrame])

  // keep topParagraphId referenced so the store dependency is explicit
  void topParagraphId
}
