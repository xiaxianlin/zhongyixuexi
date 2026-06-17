import { invokeRaw } from './ipc'
import type { CreateNoteInput, ParagraphNoteCard } from '@/modules/notes/types'

export const notesApi = {
  create: (input: CreateNoteInput) => invokeRaw<ParagraphNoteCard>('notes:create', input),

  delete: (id: string) => invokeRaw<{ ok: true }>('notes:delete', { id }),

  getByParagraph: (paragraphId: string) =>
    invokeRaw<ParagraphNoteCard[]>('notes:getByParagraph', { paragraph_id: paragraphId }),
}
