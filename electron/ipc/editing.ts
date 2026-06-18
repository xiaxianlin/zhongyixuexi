import { handle } from './registry'
import {
  editBookTitle,
  editChapterTitle,
  editParagraphText,
  mergeParagraphs,
  splitParagraph,
  deleteParagraphs,
} from '../services/editing'

/**
 * Editing IPC — book/chapter/paragraph title/text edits + paragraph
 * merge/split/delete. Channel naming: `<entity>:<action>`. Each handler
 * receives an `unknown` payload and casts at the boundary (matching notes.ts).
 * The {__ok} envelope is applied by registry.handle().
 */
export function registerEditingHandlers(): void {
  handle('books:updateTitle', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string; title?: string }
    return editBookTitle(p.id ?? '', p.title ?? '')
  })

  handle('chapters:updateTitle', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string; title?: string }
    return editChapterTitle(p.id ?? '', p.title ?? '')
  })

  handle('paragraphs:editText', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string; text?: string }
    return editParagraphText(p.id ?? '', p.text ?? '')
  })

  handle('paragraphs:merge', (_event, input: unknown) => {
    const p = (input ?? {}) as { paragraphIds?: string[] }
    return mergeParagraphs(Array.isArray(p.paragraphIds) ? p.paragraphIds : [])
  })

  handle('paragraphs:split', (_event, input: unknown) => {
    const p = (input ?? {}) as { paragraphId?: string; splitOffset?: number }
    return splitParagraph(p.paragraphId ?? '', Number(p.splitOffset ?? -1))
  })

  handle('paragraphs:delete', (_event, input: unknown) => {
    const p = (input ?? {}) as { paragraphIds?: string[] }
    return deleteParagraphs(Array.isArray(p.paragraphIds) ? p.paragraphIds : [])
  })
}
