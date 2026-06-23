/**
 * ExcerptsTab — right-rail tab listing the current chapter's excerpts.
 *
 * Reads excerpts from the library store. Each card shows the excerpt text (or a
 * "原文已修改" notice when stale), the note if any, and a delete button. Clicking
 * a non-stale excerpt scrolls the reading pane to it (handled by the parent
 * via the offset).
 */
import { useLibraryStore } from '@/models/library/store'

export function ExcerptsTab() {
  const excerpts = useLibraryStore((s) => s.excerpts)
  const deleteExcerpt = useLibraryStore((s) => s.deleteExcerpt)
  const locateExcerpt = useLibraryStore((s) => s.locateExcerpt)

  if (excerpts.length === 0) {
    return <p className="railtab__empty">本章还没有摘录。选中正文即可摘录。</p>
  }

  return (
    <div className="railtab__list">
      {excerpts.map((ex) => (
        <div key={ex.id} className="excerptCard">
          {ex.stale ? (
            <div className="excerptCard__stale" title="原文已被编辑，定位可能不准">
              原文已修改
            </div>
          ) : null}
          <blockquote
            className="excerptCard__text"
            onClick={() => !ex.stale && locateExcerpt(ex.start_offset, ex.end_offset)}
            role={!ex.stale ? 'button' : undefined}
            tabIndex={!ex.stale ? 0 : undefined}
          >
            {ex.excerpt_text}
          </blockquote>
          {ex.note ? <p className="excerptCard__note">{ex.note}</p> : null}
          <button
            type="button"
            className="excerptCard__del"
            aria-label="删除摘录"
            title="删除摘录"
            onClick={() => void deleteExcerpt(ex.id)}
          >
            删除
          </button>
        </div>
      ))}
    </div>
  )
}
