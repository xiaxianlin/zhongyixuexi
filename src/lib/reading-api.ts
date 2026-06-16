/**
 * Typed renderer-side IPC client for the reading module.
 *
 * Each method calls window.api.invoke(channel, ...args) via invokeRaw, which
 * unwraps the {__ok} envelope from electron/ipc/registry.ts and re-throws
 * structured errors as IpcError (src/lib/ipc.ts). Mirrors the channels
 * registered in electron/ipc/reading.ts.
 */
import { invokeRaw } from './ipc'
import type {
  ChapterContent,
  ProgressDTO,
  SaveProgressInput,
  BookmarkDTO,
  AddBookmarkInput,
  UpdateBookmarkInput,
  InterpretationDTO,
  TermLookupDTO,
} from '@/modules/reading/types'

/** reading:* — chapter content, segment-level progress, bookmarks, term lookup. */
export const readingApi = {
  // Chapter content (RD-02).
  getChapter: (bookId: string, chapterId: string) =>
    invokeRaw<ChapterContent | null>('reading:getChapter', bookId, chapterId),

  // Segment-level progress (RD-08).
  getProgress: (bookId: string) =>
    invokeRaw<ProgressDTO | null>('reading:getProgress', bookId),

  saveProgress: (input: SaveProgressInput) =>
    invokeRaw<ProgressDTO>('reading:saveProgress', input),

  // Bookmarks (RD-08).
  listBookmarks: (bookId: string) =>
    invokeRaw<BookmarkDTO[]>('reading:listBookmarks', bookId),

  addBookmark: (input: AddBookmarkInput) =>
    invokeRaw<BookmarkDTO>('reading:addBookmark', input),

  updateBookmark: (input: UpdateBookmarkInput) =>
    invokeRaw<BookmarkDTO>('reading:updateBookmark', input),

  removeBookmark: (id: string) =>
    invokeRaw<{ ok: boolean }>('reading:removeBookmark', id),

  // AI interpretation cache read (RD-03).
  getInterpretation: (paragraphId: string) =>
    invokeRaw<InterpretationDTO>('reading:getInterpretation', paragraphId),

  // Term lookup (RD-05).
  lookupTerm: (term: string) =>
    invokeRaw<TermLookupDTO>('reading:lookupTerm', term),
}
