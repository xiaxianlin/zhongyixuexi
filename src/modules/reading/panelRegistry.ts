/**
 * panelRegistry — DOM adapter that bridges the pure syncScroll algorithm
 * (syncScroll.ts) to real scroll containers (03-reading.md §7.1).
 *
 * The algorithm in syncScroll.ts depends only on a MetricsProvider (list()/get()),
 * never on the DOM. This module builds a MetricsProvider by querying the
 * rendered paragraph elements (matched by `[data-paragraph-id]`) inside a scroll
 * container and reading their offsetTop/offsetHeight. Keeping this DOM-touching
 * glue separate from the pure algorithm is what lets the algorithm be unit-tested
 * with plain fixtures (no jsdom/scroll needed).
 *
 * Why offsetTop relative to the container content (not viewport): both columns
 * share the same layout root, and `scrollTop` operates on the content box, so
 * matching offsets against scrollTop needs the segment's position within that
 * same content box. We walk offsetParent to accumulate the offset, which is
 * correct as long as the segments' offsetParent chain bottoms out at (or above)
 * the scroll container — true for the workbench where each panel is one scroller.
 */
import type { MetricsProvider, SegmentMetrics } from './syncScroll'

/**
 * Build a MetricsProvider for the paragraph elements inside `container`.
 *
 * @param container the scroll container element
 * @param selector  CSS selector matching a single paragraph block (default
 *                  `[data-paragraph-id]`)
 */
export function buildPanelMetrics(
  container: HTMLElement,
  selector = '[data-paragraph-id]',
): MetricsProvider {
  // Cache the query up front; the list is stable between renders (the algorithm
  // is invoked synchronously within a scroll handler, so a fresh query each
  // call() is fine and avoids stale references after a re-render).
  const els = Array.from(container.querySelectorAll<HTMLElement>(selector))

  // Pre-compute metrics once; offsetTop reads are layout-triggering but we pay
  // the cost a single time per scroll-tick (the algorithm calls list() once and
  // get() ≤ once).
  const metrics: SegmentMetrics[] = els.map((el) => ({
    id: el.dataset.paragraphId ?? '',
    top: offsetWithin(el, container),
    height: el.offsetHeight,
  }))

  const map = new Map<string, SegmentMetrics>()
  for (const m of metrics) {
    if (m.id) map.set(m.id, m)
  }

  return {
    list: () => metrics,
    get: (id) => map.get(id) ?? null,
  }
}

/**
 * Accumulate the element's offsetTop up the offsetParent chain until we reach
 * (or pass) the container. This yields the segment's distance from the top of
 * the container's scrollable content, which is what `scrollTop` is measured
 * against.
 */
function offsetWithin(el: HTMLElement, container: HTMLElement): number {
  let top = 0
  let cur: HTMLElement | null = el
  // Walk until we hit the container or run out of offset parents.
  while (cur && cur !== container) {
    top += cur.offsetTop
    cur = cur.offsetParent as HTMLElement | null
  }
  return top
}
