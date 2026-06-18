/**
 * ChapterList — left column of BookDetailView (business component, page-level).
 * The flat chapter list (TOC). Reads tree state from the library store and
 * dispatches selectChapter. Each item shows an "已分析" dot when the chapter
 * has any analyzed paragraph, and a ✎ button to rename the chapter inline.
 */
import { useEffect, useRef } from 'react'
import { useLibraryStore } from '@/models/library/store'

export function ChapterList() {
  const tree = useLibraryStore((s) => s.tree)
  const treeLoading = useLibraryStore((s) => s.treeLoading)
  const selectedChapterId = useLibraryStore((s) => s.selectedChapterId)
  const selectChapter = useLibraryStore((s) => s.selectChapter)

  const editingChapterId = useLibraryStore((s) => s.editingChapterId)
  const chapterDraft = useLibraryStore((s) => s.chapterDraft)
  const startEditChapter = useLibraryStore((s) => s.startEditChapter)
  const cancelEditChapter = useLibraryStore((s) => s.cancelEditChapter)
  const setChapterDraft = useLibraryStore((s) => s.setChapterDraft)
  const saveChapterTitle = useLibraryStore((s) => s.saveChapterTitle)

  return (
    <aside className="bookdetail__toc" aria-label="章">
      <div className="bookdetail__railHead">章</div>
      {treeLoading ? (
        <p className="bookdetail__empty">加载目录…</p>
      ) : tree.length === 0 ? (
        <p className="bookdetail__empty">无章节</p>
      ) : (
        <div className="bookdetail__list">
          {tree.map((chapter) => {
            const isEditing = editingChapterId === chapter.id
            return (
              <div
                key={chapter.id}
                className={
                  chapter.id === selectedChapterId
                    ? 'bookdetail__chapter is-active'
                    : 'bookdetail__chapter'
                }
              >
                {isEditing ? (
                  <ChapterTitleInput
                    value={chapterDraft}
                    onChange={setChapterDraft}
                    onCommit={() => void saveChapterTitle()}
                    onCancel={cancelEditChapter}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="bookdetail__chapterMain"
                      onClick={() => selectChapter(chapter.id)}
                    >
                      <span className="bookdetail__name">{chapter.title}</span>
                      {Boolean(chapter.analyzed) && (
                        <span
                          className="bookdetail__chapterDot"
                          aria-label="已分析"
                          title="本章已有 AI 分析"
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      className="bookdetail__editBtn"
                      aria-label="重命名章节"
                      title="重命名"
                      onClick={(e) => {
                        e.stopPropagation()
                        startEditChapter(chapter.id, chapter.title)
                      }}
                    >
                      ✎
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}

/** Inline chapter title editor: commit on Enter/blur, cancel on Esc. */
function ChapterTitleInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="bookdetail__chapterInput"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
      onBlur={() => onCommit()}
    />
  )
}
