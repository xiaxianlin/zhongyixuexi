import { handle } from './registry'
import {
  createNote,
  deleteNote,
  getNotesByParagraph,
  type CreateNoteInput,
} from '../services/notes'

export function registerNotesHandlers(): void {
  handle('notes:create', (_event, input: unknown) => createNote(input as CreateNoteInput))

  handle('notes:delete', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { id?: string }
    deleteNote(p.id ?? '')
    return { ok: true }
  })

  handle('notes:getByParagraph', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { paragraph_id?: string }
    return getNotesByParagraph(p.paragraph_id ?? '')
  })
}
