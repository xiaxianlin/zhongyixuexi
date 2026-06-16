import { handle } from './registry'
import * as reading from '../services/reading'
import type {
  SaveProgressInput,
  AddBookmarkInput,
  UpdateBookmarkInput,
} from '../services/reading'

/**
 * Reading IPC (RD-01..RD-08). Thin pass-throughs to the reading service.
 * Every handler returns via the {__ok} envelope from registry.handle.
 * Channel names follow the module:action convention (00-arch §4).
 *
 * Renderer→main typed wrappers live in src/lib/reading-api.ts.
 */
export function registerReadingHandlers(): void {
  // Chapter content (RD-02).
  handle('reading:getChapter', (_event, bookId: unknown, chapterId: unknown) =>
    reading.getChapter(bookId as string, chapterId as string),
  )

  // Segment-level progress (RD-08).
  handle('reading:getProgress', (_event, bookId: unknown) =>
    reading.getProgress(bookId as string),
  )

  handle('reading:saveProgress', (_event, input: unknown) =>
    reading.saveProgress(input as SaveProgressInput),
  )

  // Bookmarks (RD-08).
  handle('reading:listBookmarks', (_event, bookId: unknown) =>
    reading.listBookmarks(bookId as string),
  )

  handle('reading:addBookmark', (_event, input: unknown) =>
    reading.addBookmark(input as AddBookmarkInput),
  )

  handle('reading:updateBookmark', (_event, input: unknown) =>
    reading.updateBookmark(input as UpdateBookmarkInput),
  )

  handle('reading:removeBookmark', (_event, id: unknown) =>
    reading.removeBookmark(id as string),
  )

  // AI interpretation cache read (RD-03).
  handle('reading:getInterpretation', (_event, paragraphId: unknown) =>
    reading.getInterpretation(paragraphId as string),
  )

  // Term lookup (RD-05, reads SRH dictionary_terms).
  handle('reading:lookupTerm', (_event, term: unknown) =>
    reading.lookupTerm(term as string),
  )
}
