/**
 * Renderer-facing NOTE module DTOs (mirror of electron/services/notes.ts).
 * Kept dependency-free so the renderer never imports electron/* code.
 */

export interface Note {
  id: string
  title: string
  content: string
  book_id: string | null
  chapter_id: string | null
  paragraph_id: string | null
  notebook_id: string | null
  word_count: number
  pinned: boolean
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export type LinkTargetType = 'chapter' | 'paragraph' | 'term' | 'note'

export interface NoteLink {
  id: string
  source_note_id: string
  target_type: LinkTargetType
  target_id: string
  target_alias: string | null
  display_text: string | null
  position: number
  target_title?: string
  target_valid?: boolean
}

export interface Backlink extends NoteLink {
  note_title: string
  note_updated_at: number
}

export interface NoteSearchHit {
  note_id: string
  title: string
  snippet: string
  rank: number
}

export interface NoteListItem {
  id: string
  title: string
  preview: string
  content?: string
  notebook_id: string | null
  paragraph_id: string | null
  pinned: boolean
  updated_at: number
}

export interface NoteListResult {
  items: NoteListItem[]
  total: number
}

export interface Tag {
  id: string
  name: string
  color: string | null
  created_at: number
}

export interface Notebook {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
  icon: string | null
  created_at: number
  updated_at: number
}

export interface NotebookNode extends Notebook {
  children: NotebookNode[]
}

export interface CreateNoteInput {
  title?: string
  content?: string
  book_id?: string | null
  chapter_id?: string | null
  paragraph_id?: string | null
  notebook_id?: string | null
}

export interface UpdateNoteInput {
  id: string
  title?: string
  content?: string
  paragraph_id?: string | null
  notebook_id?: string | null
  pinned?: boolean
}

export interface ListFilter {
  notebook_id?: string | null
  tag_ids?: string[]
  book_id?: string | null
  limit?: number
  offset?: number
}

export interface ExportInput {
  note_ids: string[]
  format: 'md' | 'html' | 'pdf'
  out_dir: string
  bundle?: boolean
}

export interface ExportParagraphInput {
  paragraph_id: string
  include: {
    original?: boolean
    modern?: boolean
    image?: boolean
    notes?: boolean
  }
  format: 'md' | 'html' | 'pdf'
  out_dir: string
}
