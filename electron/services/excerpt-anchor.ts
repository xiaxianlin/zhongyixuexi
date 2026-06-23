/**
 * Selection re-anchoring (v3.1 detail revamp, PRD §5 / tech §4.4).
 *
 * When a chapter's `content` is edited, excerpts and selection-bound notes that
 * referenced the OLD text by [start, end) offsets may now point at the wrong
 * characters. `reanchorRange` maps one (start, end, excerptText) triple from the
 * old text to the new text and reports whether the anchor survived.
 *
 * Algorithm (cheap, dependency-free; covers the real-world editing cases —
 * localized insertions / deletions / small rewrites — without pulling in Myers):
 *  1. EXACT: if excerptText occurs exactly once in newText, re-anchor there.
 *  2. PREFIX/SUFFIX BRACKET: find the longest matching prefix + suffix of the
 *     excerpt in newText, and if their union covers most of the excerpt, place
 *     the range at the prefix start (keeps the anchor stable when only the
 *     interior changed). This is a single-substring-friendly approximation of a
 *     char-level diff and is enough for selection anchors (which are short).
 *  3. STALE: otherwise mark stale (the caller keeps excerptText as a snapshot).
 *
 * Offsets are UTF-16 code units (JS String.slice coordinates), matching how the
 * renderer measures selection ranges against chapters.content.
 *
 * Pure + side-effect-free so it is unit-testable without a database.
 */

export interface ReanchorInput {
  oldText: string
  newText: string
  start: number
  end: number
  /** The originally selected substring (stored alongside the offsets). */
  excerptText: string
}

export interface ReanchorResult {
  start: number
  end: number
  /** 1 when the anchor could not be confidently relocated. */
  stale: 0 | 1
}

const MIN_OVERLAP_RATIO = 0.6

export function reanchorRange(input: ReanchorInput): ReanchorResult {
  const { oldText, newText, start, end, excerptText } = input

  // An empty excerpt cannot be reliably relocated — always stale.
  if (!excerptText) {
    return { ...clampRange(start, end, newText), stale: 1 }
  }

  // No-op when the text didn't change and the range is still valid.
  if (oldText === newText) {
    return clampRange(start, end, newText)
  }

  // 1. EXACT single-occurrence match.
  const exact = singleIndexOf(newText, excerptText)
  if (exact >= 0) {
    return { start: exact, end: exact + excerptText.length, stale: 0 }
  }

  // 2. PREFIX/SUFFIX bracket: best-effort localized relocation.
  const bracketed = bracketRelocate(newText, excerptText)
  if (bracketed) {
    return { start: bracketed.start, end: bracketed.end, stale: 0 }
  }

  // 3. STALE — keep the original offsets clamped to the new length so the UI
  //    can still render something, but flag it so the card shows "原文已修改".
  return { ...clampRange(start, end, newText), stale: 1 }
}

/** Index of the only occurrence of needle in haystack, or -1 if 0 or 2+. */
function singleIndexOf(haystack: string, needle: string): number {
  if (!needle) return -1
  const first = haystack.indexOf(needle)
  if (first < 0) return -1
  const second = haystack.indexOf(needle, first + 1)
  return second < 0 ? first : -1
}

/**
 * Find the longest (prefix, suffix) of `excerpt` that both appear in `text` with
 * the prefix starting before the suffix, and whose combined length covers enough
 * of the excerpt. Returns the implied [start, end) in `text`, or null.
 *
 * The anchor start is the prefix's position; the end is the suffix's end. This
 * stays stable when the user edited text AROUND or INSIDE the selection but left
 * recognizable bookends (the common case for fixing typos in a classical text).
 */
function bracketRelocate(
  text: string,
  excerpt: string,
): { start: number; end: number } | null {
  const maxPrefix = Math.min(excerpt.length, 24)
  let prefixLen = 0
  let prefixAt = -1
  for (let len = maxPrefix; len >= 1; len--) {
    const frag = excerpt.slice(0, len)
    const at = text.indexOf(frag)
    if (at >= 0) {
      prefixLen = len
      prefixAt = at
      break
    }
  }

  const maxSuffix = Math.min(excerpt.length - prefixLen, 24)
  let suffixLen = 0
  let suffixAt = -1
  for (let len = maxSuffix; len >= 1; len--) {
    const frag = excerpt.slice(excerpt.length - len)
    // search after the prefix so the bookends don't overlap
    const from = prefixAt >= 0 ? prefixAt + prefixLen : 0
    const at = text.indexOf(frag, from)
    if (at >= 0) {
      suffixLen = len
      suffixAt = at
      break
    }
  }

  if (prefixLen === 0 && suffixLen === 0) return null
  const covered = prefixLen + suffixLen
  if (excerpt.length > 0 && covered / excerpt.length < MIN_OVERLAP_RATIO) return null

  const start = prefixLen > 0 ? prefixAt : suffixAt
  const end = suffixLen > 0 ? suffixAt + suffixLen : prefixAt + prefixLen
  if (end <= start) return null
  return { start, end }
}

/** Clamp a range to the text bounds; returns stale 0. */
function clampRange(start: number, end: number, text: string): ReanchorResult {
  const len = text.length
  const s = Math.max(0, Math.min(start, len))
  const e = Math.max(s, Math.min(end, len))
  return { start: s, end: e, stale: 0 }
}
