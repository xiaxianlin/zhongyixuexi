import { handle } from './registry'
import {
  editBookTitle,
  editChapterTitle,
  createBook,
  deleteBook,
  createChapter,
  deleteChapter,
  setBookCategory,
  createChildChapter,
  saveChapterContent,
} from '../services/editing'

/**
 * Editing IPC (v3.1 chapter-level model) — book/chapter create/delete + title
 * edits + whole-chapter content edits + category. Channel naming: `<entity>:<action>`.
 * Each handler receives an `unknown` payload and casts at the boundary. The
 * {__ok} envelope is applied by registry.handle().
 *
 * There are no paragraph-level channels (no merge / split / paragraph text edit)
 * — the chapter is the editing atom.
 */
export function registerEditingHandlers(): void {
  handle('books:updateTitle', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string; title?: string }
    return editBookTitle(p.id ?? '', p.title ?? '')
  })

  handle('books:create', (_event, input: unknown) => {
    const p = (input ?? {}) as { title?: string; author?: string }
    return createBook(p.title ?? '', p.author)
  })

  handle('books:delete', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string }
    return deleteBook(p.id ?? '')
  })

  handle('books:setCategory', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string; category?: string }
    return setBookCategory(p.id ?? '', p.category ?? 'modern')
  })

  handle('chapters:updateTitle', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string; title?: string }
    return editChapterTitle(p.id ?? '', p.title ?? '')
  })

  // Save whole-chapter plain text (reading-pane edit). Re-anchors excerpts +
  // selection-bound notes inside the same transaction.
  handle('chapters:saveContent', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string; text?: string }
    return saveChapterContent(p.id ?? '', p.text ?? '')
  })

  handle('chapters:create', (_event, input: unknown) => {
    const p = (input ?? {}) as { bookId?: string; title?: string }
    return createChapter(p.bookId ?? '', p.title ?? '')
  })

  // create a child chapter (nested under parentId) or a root when null.
  handle('chapters:createChild', (_event, input: unknown) => {
    const p = (input ?? {}) as { bookId?: string; parentId?: string | null; title?: string }
    return createChildChapter(p.bookId ?? '', p.parentId ?? null, p.title ?? '')
  })

  handle('chapters:delete', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string }
    return deleteChapter(p.id ?? '')
  })
}
