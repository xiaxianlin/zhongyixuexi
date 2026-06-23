/**
 * NotesTab — chapter + selection-bound notes (v3.1 D6, 析 → 笔记).
 *
 * Reads notesByChapter from the library store. Selection-anchored notes show
 * their quote; free notes show content only. Each card can be deleted. The
 * "+ 笔记" button opens the note editor (no pre-filled quote); the selection
 * toolbar's 写笔记 button opens the same editor with the quote pre-filled.
 */
import { useLibraryStore } from '@/models/library/store'

export function NotesTab() {
  const notes = useLibraryStore((s) => s.notesByChapter)
  const openNoteEditor = useLibraryStore((s) => s.openNoteEditor)
  const setNoteDeleteTarget = useLibraryStore((s) => s.setNoteDeleteTarget)

  if (notes.length === 0) {
    return (
      <div className="notestab__empty">
        <p className="railtab__empty">本章还没有笔记。选中正文写选区笔记，或点下方新建自由笔记。</p>
        <button type="button" className="notestab__add" onClick={() => openNoteEditor(null)}>
          + 笔记
        </button>
      </div>
    )
  }

  return (
    <div className="notestab">
      <div className="notestab__list">
        {notes.map((n) => (
          <div key={n.id} className="notecard">
            {n.stale ? (
              <div className="notecard__stale" title="原文已被编辑，定位可能不准">
                原文已修改
              </div>
            ) : null}
            {n.quote_text ? (
              <blockquote className="notecard__quote">{n.quote_text}</blockquote>
            ) : null}
            <p className="notecard__content">{n.content}</p>
            <button
              type="button"
              className="notecard__del"
              aria-label="删除笔记"
              title="删除笔记"
              onClick={() => setNoteDeleteTarget(n)}
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="notestab__add" onClick={() => openNoteEditor(null)}>
        + 笔记
      </button>
    </div>
  )
}
