/**
 * Pure helpers for the library detail view. Extracted from LibraryView so the
 * view layer stays declarative and these can be unit-tested in isolation.
 */
import type { ChapterNode } from '@/lib/types'

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
