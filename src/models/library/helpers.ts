/**
 * Pure helpers for the library detail flow. Kept dependency-free so they can be
 * unit-tested in isolation and imported by both the store and view components.
 */
import type { ChapterNode } from '@/models/shared/types'

/** Flatten a nested chapter tree into a flat list (pre-order DFS). */
export function flattenChapters(chapters: ChapterNode[]): ChapterNode[] {
  return chapters.flatMap((chapter) => [chapter, ...flattenChapters(chapter.children)])
}

/** Distribute items round-robin into N columns (preserves order within a column). */
export function splitIntoColumns<T>(items: T[], columnCount: number): T[][] {
  return items.reduce<T[][]>(
    (columns, item, index) => {
      columns[index % columnCount].push(item)
      return columns
    },
    Array.from({ length: columnCount }, () => []),
  )
}

/** Collapse blank/whitespace-only lines and trim each line. */
export function compactAnalysisText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Format the medical explanation block: when a paragraph starts with a numbered
 * lead line ("1." / "1、") followed by content, drop the descriptive lead line
 * and keep just the number prefix joined to the body.
 */
export function formatMedicalExplanation(explanation: string): string {
  return explanation
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length >= 2 && /^\d+[.、]\s*/.test(lines[0])) {
        const prefix = lines[0].match(/^(\d+[.、])/)?.[1] ?? ''
        return `${prefix} ${lines.slice(1).join('\n')}`.trim()
      }
      return lines.join('\n')
    })
    .join('\n')
}

/**
 * Compute the overall book reading progress (0..1), chapter-level (v3.1).
 * Deterministic, pure — exported for unit testing.
 *
 *   percent = (chapterFlatIndex + scrollRatio) / totalChapters
 *
 * where scrollRatio is how far the user has scrolled through the current
 * chapter's content (0..1, from the reading pane). The last chapter clamps to
 * exactly 1.0 at full scroll so a finished book shows 100%.
 */
export function computeBookPercent(params: {
  flatChapters: { id: string }[]
  selectedChapterId: string | null
  scrollRatio: number
}): number {
  const { flatChapters, selectedChapterId, scrollRatio } = params
  const totalChapters = flatChapters.length
  if (totalChapters === 0 || !selectedChapterId) return 0

  const chapterIndex = flatChapters.findIndex((c) => c.id === selectedChapterId)
  if (chapterIndex === -1) return 0

  const ratio = Number.isFinite(scrollRatio) ? Math.min(1, Math.max(0, scrollRatio)) : 0
  const raw = (chapterIndex + ratio) / totalChapters
  // Clamp: scrolling to the end of the last chapter shows exactly 100%.
  if (chapterIndex === totalChapters - 1 && ratio >= 1) return 1
  return Math.min(1, Math.max(0, raw))
}
