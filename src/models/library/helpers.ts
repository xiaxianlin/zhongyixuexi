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
 * Compute the overall book reading progress (0..1) for the chapter-index method
 * (RD-02 / LRN-01). Deterministic, pure — exported for unit testing.
 *
 *   percent = (chapterFlatIndex + withinChapterFraction) / totalChapters
 *
 * where withinChapterFraction is how far the selected paragraph sits inside the
 * current chapter's paragraph list. The last chapter's last paragraph clamps to
 * exactly 1.0 so a finished book shows 100%.
 *
 * All inputs are data already held by the library store (flatChapters comes from
 * flattenChapters(tree); paragraphs is the current chapter's ParagraphDTO[]),
 * so this needs no extra IPC/SQL.
 */
export function computeBookPercent(params: {
  flatChapters: { id: string }[]
  selectedChapterId: string | null
  paragraphs: { id: string; order_index: number }[]
  selectedParagraphId: string | null
}): number {
  const { flatChapters, selectedChapterId, paragraphs, selectedParagraphId } = params
  const totalChapters = flatChapters.length
  if (totalChapters === 0 || !selectedChapterId) return 0

  const chapterIndex = flatChapters.findIndex((c) => c.id === selectedChapterId)
  if (chapterIndex === -1) return 0

  // Within-chapter fraction: position of the selected paragraph in the loaded
  // chapter's paragraph list (1-based / count), so the first paragraph = 1/n.
  let withinFraction = 0
  if (paragraphs.length > 0 && selectedParagraphId) {
    const paraIndex = paragraphs.findIndex((p) => p.id === selectedParagraphId)
    if (paraIndex !== -1) {
      withinFraction = (paraIndex + 1) / paragraphs.length
    }
  }

  const raw = (chapterIndex + withinFraction) / totalChapters
  // Clamp: a value slightly under 1 when on the final paragraph of the last
  // chapter (e.g. 80/81 + 1/1) would otherwise never reach 100%.
  const isLastChapter = chapterIndex === totalChapters - 1
  const isLastParagraph = paraIndexIsLast(paragraphs, selectedParagraphId)
  if (isLastChapter && isLastParagraph) return 1
  return Math.min(1, Math.max(0, raw))
}

function paraIndexIsLast(
  paragraphs: { id: string }[],
  selectedParagraphId: string | null,
): boolean {
  if (paragraphs.length === 0 || !selectedParagraphId) return false
  return paragraphs[paragraphs.length - 1]!.id === selectedParagraphId
}
