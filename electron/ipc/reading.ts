import { handle } from './registry'
import * as reading from '../services/reading'
import type { SaveProgressInput } from '../services/reading'

/**
 * Reading IPC (v3.1 chapter-level model). The reading pane loads whole-chapter
 * plain text + active analysis via chapters:getContent, and persists reading
 * progress via reading:saveProgress. There is no paragraph loader (the chapter
 * is the reading atom).
 *
 * Every handler returns via the {__ok} envelope from registry.handle. Channel
 * names follow the module:action convention (00-arch §4).
 */
export function registerReadingHandlers(): void {
  // whole-chapter plain text + active analysis, for the reading pane.
  handle('chapters:getContent', (_event, bookId: unknown, chapterId: unknown) =>
    reading.getChapterContent(bookId as string, chapterId as string),
  )

  // RD-02: persist per-book reading progress (one row per book, UPSERT +
  // read_seconds accumulation). Debounce is renderer-side.
  handle('reading:saveProgress', (_event, input: unknown) =>
    reading.saveProgress(input as SaveProgressInput),
  )
}
