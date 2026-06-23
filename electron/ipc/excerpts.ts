import { handle } from './registry'
import {
  createExcerpt,
  listExcerptsByChapter,
  listExcerptsByBook,
  deleteExcerpt,
} from '../services/excerpts'

/**
 * Excerpts IPC (v3.1 EXC module). Selection-anchored highlights, pure-local.
 * Re-anchoring on chapter-content edits is invoked internally by the editing
 * service (saveChapterContent); it is not exposed as its own channel.
 */
export function registerExcerptsHandlers(): void {
  handle('excerpts:create', (_event, input: unknown) => {
    const p = (input ?? {}) as {
      bookId?: string
      chapterId?: string
      start?: number
      end?: number
      text?: string
      note?: string | null
    }
    return createExcerpt({
      bookId: p.bookId,
      chapterId: p.chapterId ?? '',
      start: Number(p.start ?? -1),
      end: Number(p.end ?? -1),
      text: p.text ?? '',
      note: p.note ?? null,
    })
  })

  handle('excerpts:listByChapter', (_event, input: unknown) => {
    const p = (input ?? {}) as { chapterId?: string }
    return listExcerptsByChapter(p.chapterId ?? '')
  })

  handle('excerpts:listByBook', (_event, input: unknown) => {
    const p = (input ?? {}) as { bookId?: string }
    return listExcerptsByBook(p.bookId ?? '')
  })

  handle('excerpts:delete', (_event, input: unknown) => {
    const p = (input ?? {}) as { id?: string }
    return deleteExcerpt(p.id ?? '')
  })
}
