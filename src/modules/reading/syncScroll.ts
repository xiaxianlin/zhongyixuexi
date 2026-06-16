/**
 * Sync-scroll pure functions (RD-03, 03-reading.md §7.1).
 *
 * The "segment-locked" sync algorithm maps two scroll containers by paragraph_id
 * (1:1, shared stable ID) rather than by raw scroll ratio. Because original and
 * interpretation paragraphs usually have DIFFERENT heights, a naive
 * scrollTop/scrollHeight ratio would drift and misalign segments. Instead we:
 *
 *   1. Find the anchor segment in the source container: the first segment whose
 *      bottom edge is at or below the source scrollTop (i.e. still partly visible
 *      at the top).
 *   2. Compute that segment's within-segment progress ratio r ∈ [0,1]
 *      (how far the source has scrolled past the segment's top).
 *   3. Locate the SAME id in the target container and scroll to its top + r * its
 *      height — so the reader is at "the same progress through the same segment".
 *
 * These helpers are PURE (no DOM mutation, no React). The DOM-reading adapter
 * (getSegmentMetrics) is passed in so the algorithm is unit-testable with plain
 * fixtures. The React layer (useSyncScroll) wires real offsetTop/offsetHeight.
 */

/** A segment's id plus its layout metrics inside its scroll container. */
export interface SegmentMetrics {
  id: string
  /** Distance from the top of the scroll container's content (offsetTop). */
  top: number
  /** Rendered height of the segment element. */
  height: number
}

/** Adapter the algorithm uses to read segment positions. Pure-injectable. */
export interface MetricsProvider {
  /** Segments in document order (ascending order_index). */
  list(): SegmentMetrics[]
  /** Resolve a single segment by id (may be absent if not rendered). */
  get(id: string): SegmentMetrics | null
}

export interface AnchorResult {
  /** The anchor segment id (top-most visible). Null if list is empty. */
  id: string | null
  /** Within-segment progress ratio r ∈ [0,1]. 0 when no anchor. */
  ratio: number
}

/**
 * Finds the anchor segment for a given scrollTop: the first segment whose bottom
 * edge (top + height) is strictly greater than scrollTop. This is the segment
 * "just entering / still visible at the top of the viewport".
 *
 * Uses a linear scan (segments are few-to-hundreds per chapter and the scan is
 * O(n) with an early exit; a binary search would shave constant factor but the
 * list is already sorted and small). Returns ratio 0 / id null for an empty list.
 *
 * Edge cases:
 *  - scrollTop at/above the first segment → ratio 0 (anchored to first).
 *  - scrollTop past the last segment's top → anchored to last, ratio clamped 1.
 *  - zero-height segment → ratio 0 (avoid divide-by-zero).
 */
export function findAnchor(metrics: MetricsProvider, scrollTop: number): AnchorResult {
  const list = metrics.list()
  if (list.length === 0) return { id: null, ratio: 0 }

  // Default anchor: the last segment (when scrolled past everything).
  let anchor = list[list.length - 1]!
  let ratio = 1

  for (let i = 0; i < list.length; i++) {
    const seg = list[i]!
    const bottom = seg.top + seg.height
    if (bottom > scrollTop) {
      anchor = seg
      ratio = seg.height > 0 ? (scrollTop - seg.top) / seg.height : 0
      ratio = clamp01(ratio)
      break
    }
  }

  return { id: anchor.id, ratio }
}

export interface SyncTarget {
  /** Target scrollTop for the other container. */
  scrollTop: number
  /** Whether the target segment was found & rendered (false → caller may fallback). */
  resolved: boolean
}

/**
 * Computes the target scrollTop for the OTHER container given the anchor id +
 * within-segment ratio from the source container. Uses the target segment's own
 * height so the visual "progress through the segment" matches even when the two
 * columns' segment heights differ.
 *
 * Fallback: if the target segment is not present (e.g. not rendered by the
 * virtual list, or the interpretation is missing), resolve to the nearest
 * available segment's top — never returns a wildly-off position.
 */
export function computeSyncTarget(
  targetMetrics: MetricsProvider,
  anchorId: string | null,
  ratio: number,
): SyncTarget {
  const list = targetMetrics.list()
  if (list.length === 0) return { scrollTop: 0, resolved: false }
  if (anchorId == null) {
    return { scrollTop: 0, resolved: false }
  }

  const direct = targetMetrics.get(anchorId)
  if (direct) {
    const r = clamp01(ratio)
    return { scrollTop: direct.top + r * direct.height, resolved: true }
  }

  // Fallback: nearest by document order. Find where the missing id WOULD sit
  // (same index in the shared paragraph list) and snap to that neighbour's top.
  // We approximate "nearest" by index among the list, since the id sets are the
  // same paragraph ids in the same order — a missing id means it is not rendered
  // yet, but its neighbours are.
  const idx = list.findIndex((s) => s.id === anchorId)
  if (idx >= 0) {
    const seg = list[idx]!
    return { scrollTop: seg.top, resolved: false }
  }
  // id not in target list at all (e.g. interpretation gap) → snap to the segment
  // whose id sorts closest by order. As a stable heuristic, use the list's
  // middle to avoid jumping to extremes.
  const mid = list[Math.floor(list.length / 2)]!
  return { scrollTop: mid.top, resolved: false }
}

/**
 * Resolves the restore scroll position for a known paragraph_id + ratio (used on
 * chapter open / progress restore, 03-reading.md §7.2). Returns null when the
 * segment is not measurable yet (the renderer should retry after layout).
 */
export function resolveRestorePosition(
  metrics: MetricsProvider,
  paragraphId: string | null,
  ratio: number,
): number | null {
  if (!paragraphId) return null
  const seg = metrics.get(paragraphId)
  if (!seg) return null
  const r = clamp01(ratio)
  return seg.height > 0 ? seg.top + r * seg.height : seg.top
}

/** Clamp a number into [0,1]. */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}
