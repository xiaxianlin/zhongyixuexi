import { handle } from './registry'
import * as reading from '../services/reading'
import type { SaveProgressInput } from '../services/reading'

/**
 * Reading IPC. Current UI uses it to fetch chapter paragraphs for the
 * library detail page and to persist reading progress (RD-02).
 * Every handler returns via the {__ok} envelope from registry.handle.
 * Channel names follow the module:action convention (00-arch §4).
 *
 * Renderer→main typed wrappers live in src/lib/reading-api.ts.
 */
export function registerReadingHandlers(): void {
  handle('reading:getChapter', (_event, bookId: unknown, chapterId: unknown) =>
    reading.getChapter(bookId as string, chapterId as string),
  )

  // RD-02: persist per-book reading progress (one row per book, UPSERT +
  // read_seconds accumulation). Debounce is renderer-side.
  handle('reading:saveProgress', (_event, input: unknown) =>
    reading.saveProgress(input as SaveProgressInput),
  )
}
