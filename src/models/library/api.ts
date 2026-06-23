/**
 * Library domain renderer IPC client (v3.1 chapter-level model).
 *
 * Combines the library-related channel families used by the book-detail flow:
 * library:* (book list + chapter tree), chapters:* (whole-chapter content +
 * edits), excerpts:* (selection-anchored highlights). Each method unwraps the
 * {__ok} envelope via models/shared/ipc.ts and re-throws structured errors.
 *
 * Mirrors channels registered in electron/ipc/{library,reading,editing,excerpts}.ts.
 * Components never call these directly — they go through useLibraryStore.
 */
import { invokeRaw } from '@/models/shared/ipc'
import type { BookListItem, ChapterNode } from '@/models/shared/types'
import type {
  ChapterContentView,
  CreateChildChapterInput,
  CreateChapterInput,
  CreateBookInput,
  CreateExcerptInput,
  DeleteInput,
  EditBookTitleInput,
  EditChapterTitleInput,
  ExcerptDTO,
  SaveProgressInput,
  SetBookCategoryInput,
  SetBookCategoryResult,
  TitleResult,
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
  // whole-chapter plain text + active analysis (reading pane).
  getChapterContent: (bookId: string, chapterId: string) =>
    invokeRaw<ChapterContentView | null>('chapters:getContent', bookId, chapterId),

  // UPSERT per-book progress (read_seconds is a delta, accumulated main-side).
  saveProgress: (input: SaveProgressInput) =>
    invokeRaw<{ ok: true }>('reading:saveProgress', input),
}

/** excerpts:* — selection-anchored highlights (v3.1 EXC module, pure-local). */
export const excerptsApi = {
  create: (input: CreateExcerptInput) => invokeRaw<ExcerptDTO>('excerpts:create', input),
  listByChapter: (chapterId: string) =>
    invokeRaw<ExcerptDTO[]>('excerpts:listByChapter', { chapterId }),
  listByBook: (bookId: string) =>
    invokeRaw<ExcerptDTO[]>('excerpts:listByBook', { bookId }),
  delete: (id: string) => invokeRaw<{ ok: true }>('excerpts:delete', { id }),
}

/** editing:* — book/chapter title + chapter content edits + category + CRUD. */
export const editingApi = {
  editBookTitle: (input: EditBookTitleInput) =>
    invokeRaw<TitleResult>('books:updateTitle', input),
  editChapterTitle: (input: EditChapterTitleInput) =>
    invokeRaw<TitleResult>('chapters:updateTitle', input),
  saveChapterContent: (input: { id: string; text: string }) =>
    invokeRaw<ChapterContentView>('chapters:saveContent', input),
  setBookCategory: (input: SetBookCategoryInput) =>
    invokeRaw<SetBookCategoryResult>('books:setCategory', input),
  // create / delete — books, chapters
  createBook: (input: CreateBookInput) => invokeRaw<TitleResult>('books:create', input),
  deleteBook: (input: DeleteInput) => invokeRaw<{ ok: true }>('books:delete', input),
  createChapter: (input: CreateChapterInput) =>
    invokeRaw<ChapterContentView>('chapters:create', input),
  createChildChapter: (input: CreateChildChapterInput) =>
    invokeRaw<ChapterContentView>('chapters:createChild', input),
  deleteChapter: (input: DeleteInput) => invokeRaw<{ ok: true }>('chapters:delete', input),
}
