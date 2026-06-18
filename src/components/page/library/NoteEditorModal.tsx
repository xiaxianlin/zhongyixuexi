/**
 * NoteEditorModal — textarea modal (business component, page-level) for drafting
 * a note on the selected paragraph. Reads noteDraftContent/noteSaving/
 * noteModalOpen/selectedParagraphId from the store and dispatches
 * setNoteDraftContent / setNoteModalOpen / createParagraphNote.
 *
 * `bookId` and `chapterId` are passed in from the view (they come from URL
 * params, not the store) and forwarded to createParagraphNote.
 */
import { useLibraryStore } from '@/models/library/store'

interface NoteEditorModalProps {
  bookId: string
  chapterId: string | null
}

export function NoteEditorModal({ bookId, chapterId }: NoteEditorModalProps) {
  const noteModalOpen = useLibraryStore((s) => s.noteModalOpen)
  const selectedParagraphId = useLibraryStore((s) => s.selectedParagraphId)
  const noteDraftContent = useLibraryStore((s) => s.noteDraftContent)
  const noteSaving = useLibraryStore((s) => s.noteSaving)
  const setNoteDraftContent = useLibraryStore((s) => s.setNoteDraftContent)
  const setNoteModalOpen = useLibraryStore((s) => s.setNoteModalOpen)
  const createParagraphNote = useLibraryStore((s) => s.createParagraphNote)

  if (!noteModalOpen || !selectedParagraphId || !chapterId) return null

  return (
    <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
      <div className="bookdetail__modal">
        <div className="bookdetail__modalHead">
          <h3>添加笔记</h3>
          <button type="button" onClick={() => setNoteModalOpen(false)}>
            ×
          </button>
        </div>
        <textarea
          className="bookdetail__noteDraft"
          value={noteDraftContent}
          onChange={(event) => setNoteDraftContent(event.target.value)}
          placeholder="记下这一段的疑问、心得或临证联想"
          rows={8}
        />
        <div className="bookdetail__modalActions">
          <button type="button" className="bookdetail__btn" onClick={() => setNoteModalOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className="bookdetail__primary"
            disabled={noteSaving}
            onClick={() => void createParagraphNote(bookId, chapterId)}
          >
            {noteSaving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
