/**
 * Unit tests for the SM-2 scheduling pure function (04-learning.md §10.1).
 *
 * These tests mirror the schedule() function re-implemented on the renderer
 * side (src/modules/learning/sm2.ts) which is a pure copy of the server-side
 * electron/services/learning.ts schedule(). The canonical test lives here
 * because schedule() is pure logic with no DB dependency.
 *
 * Coverage:
 *  - EF delta for each grade (0/3/4/5) matches §7.1.3 table
 *  - EF floor at 1.3
 *  - Interval sequence for consecutive 'good': 1 → 6 → 15 → 38
 *  - Lapse (again): repetitions=0, interval=1, due_at=now+1d
 *  - New card first 'good': n=1, ivl=1
 *  - nextInterval edge cases (n=0,1,2,3+)
 */
import { describe, it, expect } from 'vitest'
import { schedule, nextInterval, GRADE_MAP } from './sm2'
import type { SchedState } from './sm2'

const NOW = 1_700_000_000_000 // fixed timestamp for deterministic tests
const DAY_MS = 24 * 3600 * 1000

/** Fresh new card state. */
const NEW_CARD: SchedState = { ease_factor: 2.5, interval_days: 0, repetitions: 0 }

describe('GRADE_MAP', () => {
  it('maps four UI buttons to SM-2 0/3/4/5', () => {
    expect(GRADE_MAP).toEqual({ again: 0, hard: 3, good: 4, easy: 5 })
  })
})

describe('nextInterval', () => {
  it('returns 0 for n <= 0', () => {
    expect(nextInterval(0, 2.5, 10)).toBe(0)
    expect(nextInterval(-1, 2.5, 10)).toBe(0)
  })

  it('returns 1 for n = 1', () => {
    expect(nextInterval(1, 2.5, 0)).toBe(1)
  })

  it('returns 6 for n = 2', () => {
    expect(nextInterval(2, 2.5, 1)).toBe(6)
  })

  it('returns round(prevInterval × EF) for n >= 3', () => {
    expect(nextInterval(3, 2.5, 6)).toBe(15)
    expect(nextInterval(4, 2.5, 15)).toBe(38)
    expect(nextInterval(3, 1.3, 6)).toBe(8)
  })
})

describe('schedule — EF deltas', () => {
  it('easy (q=5): EF += 0.100', () => {
    const r = schedule(NEW_CARD, 'easy', NOW)
    // 2.5 + 0.1 = 2.6
    expect(r.ease_factor).toBe(2.6)
  })

  it('good (q=4): EF unchanged (Δ=0)', () => {
    const r = schedule(NEW_CARD, 'good', NOW)
    // Formula: 0.1 - (5-4)*(0.08 + (5-4)*0.02) = 0.1 - 1*0.10 = 0.0
    // EF stays 2.5
    expect(r.ease_factor).toBe(2.5)
  })

  it('hard (q=3): EF -= 0.140', () => {
    const r = schedule(NEW_CARD, 'hard', NOW)
    // 2.5 - 0.14 = 2.36
    expect(r.ease_factor).toBe(2.36)
  })

  it('again (q=0): EF -= 0.800', () => {
    const r = schedule(NEW_CARD, 'again', NOW)
    // 2.5 - 0.8 = 1.7
    expect(r.ease_factor).toBe(1.7)
  })
})

describe('schedule — EF floor', () => {
  it('EF never drops below 1.3 even after many agains', () => {
    let state: SchedState = { ease_factor: 1.5, interval_days: 10, repetitions: 5 }
    for (let i = 0; i < 10; i++) {
      state = schedule(state, 'again', NOW + i * DAY_MS)
    }
    expect(state.ease_factor).toBeGreaterThanOrEqual(1.3)
    expect(state.ease_factor).toBe(1.3)
  })
})

describe('schedule — interval sequence', () => {
  it('consecutive good grades produce 1 → 6 → 15 → 38', () => {
    let state = NEW_CARD
    const intervals: number[] = []

    // 1st good
    state = schedule(state, 'good', NOW)
    intervals.push(state.interval_days)

    // 2nd good
    state = schedule(state, 'good', NOW + DAY_MS)
    intervals.push(state.interval_days)

    // 3rd good
    state = schedule(state, 'good', NOW + 2 * DAY_MS)
    intervals.push(state.interval_days)

    // 4th good
    state = schedule(state, 'good', NOW + 3 * DAY_MS)
    intervals.push(state.interval_days)

    expect(intervals).toEqual([1, 6, 15, 38])
  })
})

describe('schedule — lapse (again)', () => {
  it('again resets repetitions to 0 and sets interval to 1', () => {
    const state: SchedState = { ease_factor: 2.5, interval_days: 15, repetitions: 3 }
    const r = schedule(state, 'again', NOW)
    expect(r.repetitions).toBe(0)
    expect(r.interval_days).toBe(1)
    expect(r.next_interval_days).toBe(1)
  })

  it('again sets due_at = now + 1 day', () => {
    const r = schedule(NEW_CARD, 'again', NOW)
    expect(r.next_due_at).toBe(NOW + 1 * DAY_MS)
  })
})

describe('schedule — new card first review', () => {
  it('first good: n=1, ivl=1, due = now + 1d', () => {
    const r = schedule(NEW_CARD, 'good', NOW)
    expect(r.repetitions).toBe(1)
    expect(r.interval_days).toBe(1)
    expect(r.next_due_at).toBe(NOW + DAY_MS)
  })

  it('first easy: n=1, ivl=1 (still first step), due = now + 1d', () => {
    const r = schedule(NEW_CARD, 'easy', NOW)
    expect(r.repetitions).toBe(1)
    expect(r.interval_days).toBe(1)
  })
})

describe('schedule — due_at computation', () => {
  it('due_at = now + interval_days × DAY_MS', () => {
    const state: SchedState = { ease_factor: 2.5, interval_days: 6, repetitions: 1 }
    const r = schedule(state, 'good', NOW)
    // n becomes 2, interval = 6 (fixed), due = now + 6 days
    expect(r.repetitions).toBe(2)
    expect(r.interval_days).toBe(6)
    expect(r.next_due_at).toBe(NOW + 6 * DAY_MS)
  })
})

describe('schedule — hard still counts as correct', () => {
  it('hard (q=3) increments repetitions (not a lapse)', () => {
    const state: SchedState = { ease_factor: 2.5, interval_days: 1, repetitions: 1 }
    const r = schedule(state, 'hard', NOW)
    expect(r.repetitions).toBe(2)
    expect(r.interval_days).toBe(6) // n=2 → fixed 6
  })
})
