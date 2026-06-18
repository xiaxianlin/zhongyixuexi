/**
 * Notes drawer (overlay) for the selected paragraph. Reads notes/notesLoading/
 * noteDrawerOpen from the store and dispatches setNoteDrawerOpen / setDeleteTarget.
 */
import { useLibraryStore } from '@/stores/library'
import { splitIntoColumns } from './helpers'

export function NoteDrawer() {
  const noteDrawerOpen = useLibraryStore((s) => s.noteDrawerOpen)
  const notes = useLibraryStore((s) => s.notes)
  const notesLoading = useLibraryStore((s) => s.notesLoading)
  const setNoteDrawerOpen = useLibraryStore((s) => s.setNoteDrawerOpen)
  const setDeleteTarget = useLibraryStore((s) => s.setDeleteTarget)

  if (!noteDrawerOpen) return null
  const noteColumns = splitIntoColumns(notes, 3)

  return (
    <div className="bookdetail__drawerLayer">
      <button
        type="button"
        className="bookdetail__drawerScrim"
        aria-label="关闭笔记列表"
        onClick={() => setNoteDrawerOpen(false)}
      />
      <aside className="bookdetail__noteDrawer" aria-label="笔记列表">
        <div className="bookdetail__noteDrawerHead">
          <div>
            <div className="bookdetail__drawerEyebrow">笔记</div>
            <h3>{notes.length} 篇笔记</h3>
          </div>
          <button type="button" onClick={() => setNoteDrawerOpen(false)}>
            ×
          </button>
        </div>
        {notesLoading ? (
          <p className="bookdetail__muted">加载中…</p>
        ) : notes.length === 0 ? (
          <p className="bookdetail__muted">还没有笔记</p>
        ) : (
          <div className="bookdetail__noteGrid">
            {noteColumns.map((column, columnIndex) => (
              <div key={columnIndex} className="bookdetail__noteColumn">
                {column.map((note) => (
                  <article key={note.id} className="bookdetail__noteItem">
                    <div className="bookdetail__noteItemHead">
                      <button
                        type="button"
                        className="bookdetail__noteDelete"
                        title="删除笔记"
                        onClick={(event) => {
                          event.stopPropagation()
                          setDeleteTarget(note)
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <p>{note.content || '（空）'}</p>
                  </article>
                ))}
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  )
}
