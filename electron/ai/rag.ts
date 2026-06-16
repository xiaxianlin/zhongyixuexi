/**
 * RAG retrieval + prompt assembly (S5.4 / 07-ai.md §6.3).
 *
 * Layer that bridges SRH's FTS5 searchParagraphs() to the AI prompt layer:
 * takes top-k paragraph hits, strips <mark> tags (the model doesn't need
 * highlighting), caps snippet length, and maps them into QaContext[] for
 * buildQaPrompt(). Pure transform — exported for unit testing.
 *
 * The actual FTS5 query runs in services/search.ts (SRH module owns
 * fts_paragraphs reads per 00-architecture §5.4). We never query fts_* here.
 */
import type { SearchHit } from '../services/search'
import type { QaContext } from './prompts'

/** Cap each context snippet so the prompt stays well under the model context. */
const MAX_SNIPPET_CHARS = 220

/** Strip FTS5 <mark>...</mark> wrappers — the model sees plain text. */
export function stripMarks(s: string): string {
  return (s ?? '').replace(/<\/?mark>/g, '')
}

/** Truncate to a code-point length, adding an ellipsis if truncated. */
export function capSnippet(s: string, max = MAX_SNIPPET_CHARS): string {
  const cps = Array.from(s)
  if (cps.length <= max) return s
  return cps.slice(0, max).join('') + '…'
}

/**
 * Convert SRH search hits into numbered QaContext entries for the prompt.
 *
 * - n is 1-based and stable (matches the [n] citation convention).
 * - paragraphId is injected so the model echoes it in the trailing cites JSON,
 *   letting the renderer jump to the source paragraph.
 * - snippet is mark-stripped + length-capped.
 *
 * Pure — exported for unit testing.
 */
export function hitsToContext(hits: SearchHit[], topK: number): QaContext[] {
  const k = Math.max(1, Math.min(topK, 10))
  return hits.slice(0, k).map((h, i) => ({
    n: i + 1,
    paragraphId: h.paragraphId,
    bookTitle: h.bookTitle,
    chapterTitle: h.chapterTitle,
    snippet: capSnippet(stripMarks(h.snippet)),
  }))
}
