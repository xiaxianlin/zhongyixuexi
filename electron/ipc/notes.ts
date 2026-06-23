import { handle } from './registry'
import {
  createNote,
  deleteNote,
  getNotesByChapter,
  type CreateNoteInput,
} from '../services/notes'

export function registerNotesHandlers(): void {
  handle('notes:create', (_event, input: unknown) => createNote(input as CreateNoteInput))

  handle('notes:delete', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { id?: string }
    deleteNote(p.id ?? '')
    return { ok: true }
  })

  handle('notes:listByChapter', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { chapterId?: string }
    return getNotesByChapter(p.chapterId ?? '')
  })
}
