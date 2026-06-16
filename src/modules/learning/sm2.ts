/**
 * SM-2 scheduling pure function — renderer-side copy (04-learning.md §7.1).
 *
 * This is a verbatim mirror of the canonical implementation in
 * electron/services/learning.ts. It exists so the renderer can preview
 * scheduling locally (e.g. showing "next review in N days" before the IPC
 * round-trip) and so the pure logic is unit-testable without better-sqlite3
 * (which cannot load under vitest/node ABI mismatch).
 *
 * SM-2 formula:
 *   I(1)=1, I(2)=6, I(n)=I(n-1)×EF  (n≥3)
 *   EF'=EF+(0.1-(5-q)(0.08+(5-q)0.02)), floor 1.3
 *   q<3 → lapse: repetitions=0, interval=1
 *
 * Keep this in sync with electron/services/learning.ts schedule().
 */

import { GRADE_MAP, type GradeLabel } from './types'

export interface SchedState {
  ease_factor: number
  interval_days: number
  repetitions: number
}

export interface SchedResult extends SchedState {
  next_interval_days: number
  next_due_at: number
}

export { GRADE_MAP }

const DAY_MS = 24 * 3600 * 1000

export function nextInterval(n: number, ef: number, prevInterval: number): number {
  if (n <= 0) return 0
  if (n === 1) return 1
  if (n === 2) return 6
  return Math.round(prevInterval * ef)
}

function round2(x: number): number {
  return Math.round(x * 100) / 100
}

export function schedule(prev: SchedState, label: GradeLabel, nowMs: number = Date.now()): SchedResult {
  const q = GRADE_MAP[label]
  let ef = prev.ease_factor
  let ivl = prev.interval_days
  let n = prev.repetitions

  // 1) EF update
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  ef = Math.max(1.3, ef)

  // 2) repetitions & interval
  if (q < 3) {
    n = 0
    ivl = 1
  } else {
    n = n + 1
    ivl = nextInterval(n, ef, ivl)
  }

  const next_due_at = nowMs + ivl * DAY_MS

  return {
    ease_factor: round2(ef),
    interval_days: ivl,
    repetitions: n,
    next_interval_days: ivl,
    next_due_at,
  }
}
