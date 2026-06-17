export interface CreateNoteInput {
  content?: string
  book_id?: string | null
  chapter_id?: string | null
  paragraph_id?: string | null
}

export interface ParagraphNoteCard {
  id: string
  content: string
  created_at: number
  updated_at: number
}
