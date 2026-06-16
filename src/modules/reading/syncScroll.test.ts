import { describe, it, expect } from 'vitest'
import {
  findAnchor,
  computeSyncTarget,
  resolveRestorePosition,
  type SegmentMetrics,
  type MetricsProvider,
} from './syncScroll'

/** Build a MetricsProvider from a list (get() indexes by id). */
function provider(list: SegmentMetrics[]): MetricsProvider {
  const map = new Map(list.map((s) => [s.id, s]))
  return {
    list: () => list,
    get: (id) => map.get(id) ?? null,
  }
}

/** Helper: segment with top + height. */
function seg(id: string, top: number, height: number): SegmentMetrics {
  return { id, top, height }
}

describe('findAnchor', () => {
  it('returns null id + ratio 0 for an empty list', () => {
    expect(findAnchor(provider([]), 0)).toEqual({ id: null, ratio: 0 })
  })

  it('anchors to the first segment with ratio 0 when scrolled at/above the top', () => {
    const list = [seg('a', 0, 100), seg('b', 100, 100)]
    expect(findAnchor(provider(list), 0)).toEqual({ id: 'a', ratio: 0 })
    expect(findAnchor(provider(list), -10)).toEqual({ id: 'a', ratio: 0 })
  })

  it('computes within-segment ratio for a partially-scrolled segment', () => {
    // scrollTop 250 → segment 'b' (top 200, height 100) bottom=300 > 250
    // ratio = (250 - 200) / 100 = 0.5
    const list = [seg('a', 0, 200), seg('b', 200, 100), seg('c', 300, 100)]
    expect(findAnchor(provider(list), 250)).toEqual({ id: 'b', ratio: 0.5 })
  })

  it('clamps ratio into [0,1] when scrollTop is mid-segment', () => {
    const list = [seg('a', 0, 100)]
    // scrolled to 50 → ratio 0.5
    expect(findAnchor(provider(list), 50)).toEqual({ id: 'a', ratio: 0.5 })
    // scrolled to 99 → ratio 0.99
    expect(findAnchor(provider(list), 99)).toEqual({ id: 'a', ratio: 0.99 })
  })

  it('anchors to the last segment with ratio 1 when scrolled past everything', () => {
    const list = [seg('a', 0, 100), seg('b', 100, 100)]
    // scrollTop 500 → no segment has bottom > 500 → fallback to last, ratio 1
    expect(findAnchor(provider(list), 500)).toEqual({ id: 'b', ratio: 1 })
  })

  it('skips fully-scrolled segments and picks the next visible one', () => {
    // a: 0..100, b: 100..200, c: 200..300. scrollTop 150 → a.bottom=100 ≤ 150 (skip),
    // b.bottom=200 > 150 → anchor b, ratio (150-100)/100 = 0.5
    const list = [seg('a', 0, 100), seg('b', 100, 100), seg('c', 200, 100)]
    expect(findAnchor(provider(list), 150)).toEqual({ id: 'b', ratio: 0.5 })
  })

  it('handles zero-height segments without divide-by-zero (ratio 0)', () => {
    const list = [seg('a', 0, 0), seg('b', 0, 100)]
    // a.bottom = 0, not > 0 → skip; b.bottom = 100 > 0 → anchor b ratio 0
    expect(findAnchor(provider(list), 0)).toEqual({ id: 'b', ratio: 0 })
  })
})

describe('computeSyncTarget', () => {
  it('maps the anchor id to the same segment in the target by within-segment ratio', () => {
    // Source: segment 'b' scrolled 50% (top 200, height 100).
    // Target: SAME id 'b' but DIFFERENT height (interpretation is longer).
    const target = provider([seg('a', 0, 400), seg('b', 400, 300), seg('c', 700, 200)])
    // ratio 0.5 → target.scrollTop = 400 + 0.5 * 300 = 550
    const res = computeSyncTarget(target, 'b', 0.5)
    expect(res).toEqual({ scrollTop: 550, resolved: true })
  })

  it('keeps visual alignment when segment heights differ between columns', () => {
    // Original column: a=100h, b=100h. Interpretation column: a=300h, b=500h.
    // Scrolled to halfway through original 'b' (ratio 0.5).
    const original = [seg('a', 0, 100), seg('b', 100, 100)]
    const interpretation = provider([seg('a', 0, 300), seg('b', 300, 500)])
    const anchor = findAnchor(provider(original), 150) // b, ratio 0.5
    const target = computeSyncTarget(interpretation, anchor.id, anchor.ratio)
    // Target = 300 + 0.5 * 500 = 550 → middle of interpretation 'b'. NOT a naive
    // ratio of scrollHeight (which would put us at a different spot).
    expect(target).toEqual({ scrollTop: 550, resolved: true })
    // Sanity: naive ratio sync (150/200 * 800 = 600) would be WRONG by 50px.
    expect(target.scrollTop).not.toBe(600)
  })

  it('returns scrollTop 0 + resolved false for an empty target list', () => {
    expect(computeSyncTarget(provider([]), 'a', 0.5)).toEqual({ scrollTop: 0, resolved: false })
  })

  it('returns resolved false when anchorId is null', () => {
    const target = provider([seg('a', 0, 100)])
    expect(computeSyncTarget(target, null, 0.5)).toEqual({ scrollTop: 0, resolved: false })
  })

  it('clamps ratio into [0,1] before applying', () => {
    const target = provider([seg('a', 0, 100), seg('b', 100, 100)])
    // ratio 2 → clamped to 1 → 100 + 1*100 = 200
    expect(computeSyncTarget(target, 'b', 2)).toEqual({ scrollTop: 200, resolved: true })
    // ratio -1 → clamped to 0 → 100 + 0 = 100
    expect(computeSyncTarget(target, 'b', -1)).toEqual({ scrollTop: 100, resolved: true })
  })

  it('falls back to the segment at the same index when the id is missing but present in list', () => {
    // The id IS in the list (findIndex matches) but get() returns null — simulates
    // a not-yet-measured virtual row whose slot is known. We snap to its top.
    const list = [seg('a', 0, 100), seg('b', 100, 100)]
    const target: MetricsProvider = {
      list: () => list,
      get: (id) => (id === 'b' ? null : seg('a', 0, 100)),
    }
    const res = computeSyncTarget(target, 'b', 0.5)
    // findIndex matches 'b' at idx 1 → list[1].top = 100, resolved false
    expect(res).toEqual({ scrollTop: 100, resolved: false })
  })

  it('snaps to the middle segment when the anchor id is entirely absent', () => {
    const target = provider([seg('a', 0, 100), seg('b', 100, 100), seg('c', 200, 100)])
    // 'z' not in list → middle = list[1] = 'b', top 100
    const res = computeSyncTarget(target, 'z', 0.5)
    expect(res).toEqual({ scrollTop: 100, resolved: false })
  })
})

describe('resolveRestorePosition', () => {
  it('returns null when paragraphId is null', () => {
    expect(resolveRestorePosition(provider([seg('a', 0, 100)]), null, 0.5)).toBeNull()
  })

  it('returns null when the segment is not measurable (absent)', () => {
    expect(resolveRestorePosition(provider([seg('a', 0, 100)]), 'missing', 0.5)).toBeNull()
  })

  it('computes top + ratio * height for a known segment', () => {
    const m = provider([seg('a', 0, 100), seg('b', 100, 200)])
    expect(resolveRestorePosition(m, 'b', 0.25)).toBe(150) // 100 + 0.25*200
  })

  it('clamps ratio into [0,1]', () => {
    const m = provider([seg('a', 0, 100)])
    expect(resolveRestorePosition(m, 'a', 5)).toBe(100) // clamped to 1 → 0 + 100
    expect(resolveRestorePosition(m, 'a', -5)).toBe(0) // clamped to 0
  })

  it('returns just the top for a zero-height segment', () => {
    const m = provider([seg('a', 50, 0)])
    expect(resolveRestorePosition(m, 'a', 0.5)).toBe(50)
  })
})
