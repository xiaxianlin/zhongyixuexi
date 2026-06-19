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
  ParagraphDTO,
  EditBookTitleInput,
  EditChapterTitleInput,
  EditTextInput,
  MergeParagraphsInput,
  DeleteParagraphsInput,
  SplitParagraphInput,
  TitleResult,
  SaveProgressInput,
} from './types'

/** library:* — book list (with progress aggregation) + chapter tree + reorder + cover. */
export const libraryApi = {
  list: () => invokeRaw<BookListItem[]>('library:list'),
  tree: (bookId: string) => invokeRaw<ChapterNode[]>('library:tree', bookId),
  reorder: (bookIds: string[]) =>
    invokeRaw<BookListItem[]>('library:reorder', { bookIds }),
  uploadCover: (bookId: string) => invokeRaw<BookListItem[]>('books:uploadCover', { bookId }),
}

/** reading:* — chapter content + reading-progress persistence. */
export const readingApi = {
  getChapter: (bookId: string, chapterId: string) =>
    invokeRaw<ChapterContent | null>('reading:getChapter', bookId, chapterId),

  // RD-02: UPSERT per-book progress (read_seconds is a delta, accumulated main-side).
  saveProgress: (input: SaveProgressInput) =>
    invokeRaw<{ ok: true }>('reading:saveProgress', input),
}

/** notes:* — paragraph-bound note CRUD (NOTE module, converged surface). */
export const notesApi = {
  create: (input: CreateNoteInput) => invokeRaw<ParagraphNoteCard>('notes:create', input),
  delete: (id: string) => invokeRaw<{ ok: true }>('notes:delete', { id }),
  getByParagraph: (paragraphId: string) =>
    invokeRaw<ParagraphNoteCard[]>('notes:getByParagraph', { paragraph_id: paragraphId }),
}

/** editing:* — book/chapter/paragraph text edits + paragraph merge/split. */
export const editingApi = {
  editBookTitle: (input: EditBookTitleInput) =>
    invokeRaw<TitleResult>('books:updateTitle', input),
  editChapterTitle: (input: EditChapterTitleInput) =>
    invokeRaw<TitleResult>('chapters:updateTitle', input),
  editParagraphText: (input: EditTextInput) =>
    invokeRaw<ParagraphDTO>('paragraphs:editText', input),
  mergeParagraphs: (input: MergeParagraphsInput) =>
    invokeRaw<ChapterContent>('paragraphs:merge', input),
  deleteParagraphs: (input: DeleteParagraphsInput) =>
    invokeRaw<ChapterContent>('paragraphs:delete', input),
  splitParagraph: (input: SplitParagraphInput) =>
    invokeRaw<ChapterContent>('paragraphs:split', input),
}
