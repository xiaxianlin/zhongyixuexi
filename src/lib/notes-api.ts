/**
 * Typed renderer-side client for `notes:*` channels (NOTE module).
 *
 * Lives in its own file (per dev-note.md ownership) so the notes surface is
 * self-contained; src/lib/ipc.ts stays untouched (it is not NOTE-owned). Uses
 * invokeRaw + IpcError from src/lib/ipc.ts.
 */

import { invokeRaw } from './ipc'
import type {
  Note,
  NoteListItem,
  ParagraphNoteCard,
  NoteListResult,
  NoteLink,
  Backlink,
  NoteSearchHit,
  Tag,
  NotebookNode,
  CreateNoteInput,
  UpdateNoteInput,
  ListFilter,
  ExportInput,
  ExportParagraphInput,
  LinkTargetType,
} from '@/modules/notes/types'

/** notes:* — NOTE-01~04 channels. */
export const notesApi = {
  // NOTE-01 / NOTE-05: CRUD
  create: (input: CreateNoteInput) => invokeRaw<Note>('notes:create', input),

  get: (id: string) => invokeRaw<Note | null>('notes:get', { id }),

  update: (input: UpdateNoteInput) => invokeRaw<Note>('notes:update', input),

  delete: (id: string) => invokeRaw<{ ok: true }>('notes:delete', { id }),

  // NOTE-05: paragraph note cards for reading/detail side surfaces
  getByParagraph: (paragraphId: string) =>
    invokeRaw<ParagraphNoteCard[]>('notes:getByParagraph', { paragraph_id: paragraphId }),

  getByChapter: (chapterId: string) =>
    invokeRaw<NoteListItem[]>('notes:getByChapter', { chapter_id: chapterId }),

  list: (filter?: ListFilter) => invokeRaw<NoteListResult>('notes:list', filter ?? {}),

  // NOTE-02: wiki-links + backlinks
  getOutlinks: (noteId: string) => invokeRaw<NoteLink[]>('notes:getOutlinks', { note_id: noteId }),

  getBacklinks: (targetType: LinkTargetType, targetId: string) =>
    invokeRaw<Backlink[]>('notes:getBacklinks', { target_type: targetType, target_id: targetId }),

  resolveLinkTarget: (raw: string) =>
    invokeRaw<{
      targetType: LinkTargetType
      targetId: string
      title: string
      valid: boolean
    } | null>('notes:resolveLinkTarget', { raw }),

  // NOTE-03: search + tags + notebooks
  search: (query: string, opts?: { notebook_id?: string; limit?: number }) =>
    invokeRaw<{ items: NoteSearchHit[]; total: number }>('notes:search', {
      query,
      notebook_id: opts?.notebook_id,
      limit: opts?.limit,
    }),

  listTags: (refType?: string) =>
    invokeRaw<Tag[]>('notes:listTags', { ref_type: refType }),

  setTags: (refType: string, refId: string, tagIds: string[]) =>
    invokeRaw<{ ok: true }>('notes:setTags', {
      ref_type: refType,
      ref_id: refId,
      tag_ids: tagIds,
    }),

  getTagsForRef: (refType: string, refId: string) =>
    invokeRaw<Tag[]>('notes:getTagsForRef', { ref_type: refType, ref_id: refId }),

  ensureTag: (name: string, color?: string | null) =>
    invokeRaw<Tag>('notes:ensureTag', { name, color }),

  listNotebooks: () => invokeRaw<NotebookNode[]>('notes:listNotebooks'),

  createNotebook: (name: string, parentId?: string | null) =>
    invokeRaw<NotebookNode>('notes:createNotebook', { name, parent_id: parentId ?? null }),

  renameNotebook: (id: string, name: string) =>
    invokeRaw<NotebookNode>('notes:renameNotebook', { id, name }),

  deleteNotebook: (id: string) =>
    invokeRaw<{ ok: true }>('notes:deleteNotebook', { id }),

  // NOTE-04: export
  export: (input: ExportInput) =>
    invokeRaw<{ files: string[] }>('notes:export', input),

  exportParagraph: (input: ExportParagraphInput) =>
    invokeRaw<{ file: string }>('notes:exportParagraph', input),
}
