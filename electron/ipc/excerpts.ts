import { handle } from './registry'
import { AppError } from '../lib/error'
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
    // Boundary validation: require chapterId + a sane [start,end) range before
    // touching the service (which re-validates against the live content).
    if (!p.chapterId) throw new AppError('VALIDATION', '摘录缺少 chapterId')
    if (
      !Number.isInteger(p.start) ||
      !Number.isInteger(p.end) ||
      p.start! < 0 ||
      p.end! <= p.start!
    ) {
      throw new AppError('VALIDATION', '摘录选区范围非法')
    }
    return createExcerpt({
      bookId: p.bookId,
      chapterId: p.chapterId,
      start: p.start!,
      end: p.end!,
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
