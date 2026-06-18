/**
 * Library domain renderer IPC client.
 *
 * Combines the three library-related channel families used by the book-detail
 * flow: library:* (book list + chapter tree), reading:* (chapter content),
 * notes:* (paragraph-bound note CRUD). Each method unwraps the {__ok} envelope
 * via models/shared/ipc.ts and re-throws structured errors as IpcError.
 *
 * Mirrors channels registered in electron/ipc/{library,reading,notes}.ts.
 * Components never call these directly — they go through useLibraryStore.
 */
import { invokeRaw } from '@/models/shared/ipc'
import type { BookListItem, ChapterNode } from '@/models/shared/types'
import type {
  ChapterContent,
  CreateNoteInput,
  ParagraphNoteCard,
} from './types'

/** library:* — book list (with progress aggregation) + chapter tree. */
export const libraryApi = {
  list: () => invokeRaw<BookListItem[]>('library:list'),
  tree: (bookId: string) => invokeRaw<ChapterNode[]>('library:tree', bookId),
}

/** reading:* — chapter content for the library detail page. */
export const readingApi = {
  getChapter: (bookId: string, chapterId: string) =>
    invokeRaw<ChapterContent | null>('reading:getChapter', bookId, chapterId),
}

/** notes:* — paragraph-bound note CRUD (NOTE module, converged surface). */
export const notesApi = {
  create: (input: CreateNoteInput) => invokeRaw<ParagraphNoteCard>('notes:create', input),
  delete: (id: string) => invokeRaw<{ ok: true }>('notes:delete', { id }),
  getByParagraph: (paragraphId: string) =>
    invokeRaw<ParagraphNoteCard[]>('notes:getByParagraph', { paragraph_id: paragraphId }),
}
