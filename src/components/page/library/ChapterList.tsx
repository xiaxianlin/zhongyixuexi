/**
 * ChapterList — left column of BookDetailView (business component, page-level).
 * The flat chapter list (TOC). Reads tree state from the library store and
 * dispatches selectChapter.
 */
import { useLibraryStore } from '@/models/library/store'

export function ChapterList() {
  const tree = useLibraryStore((s) => s.tree)
  const treeLoading = useLibraryStore((s) => s.treeLoading)
  const selectedChapterId = useLibraryStore((s) => s.selectedChapterId)
  const selectChapter = useLibraryStore((s) => s.selectChapter)

  return (
    <aside className="bookdetail__toc" aria-label="章">
      <div className="bookdetail__railHead">章</div>
      {treeLoading ? (
        <p className="bookdetail__empty">加载目录…</p>
      ) : tree.length === 0 ? (
        <p className="bookdetail__empty">无章节</p>
      ) : (
        <div className="bookdetail__list">
          {tree.map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className={
                chapter.id === selectedChapterId
                  ? 'bookdetail__chapter is-active'
                  : 'bookdetail__chapter'
              }
              onClick={() => selectChapter(chapter.id)}
            >
              <span className="bookdetail__name">{chapter.title}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
