/**
 * ChapterList — left column of BookDetailView (business component, page-level).
 * The flat chapter list (TOC). Reads tree state from the library store and
 * dispatches selectChapter. Each item shows an "已分析" dot when the chapter
 * has any analyzed paragraph, a ✎ button to rename, and a ✕ to delete. The
 * header has a 「＋ 章」 button to create a new chapter at the end of the book.
 */
import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '@/models/library/store'
import { Modal } from '@/components/interaction/Modal'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'

export function ChapterList({ bookId }: { bookId: string }) {
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

  const addChapter = useLibraryStore((s) => s.addChapter)
  const deleteChapter = useLibraryStore((s) => s.deleteChapter)

  // inline "new chapter" input
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  // pending chapter deletion (drives the shared ConfirmModal)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const commitAdd = () => {
    const t = newTitle.trim()
    setAdding(false)
    setNewTitle('')
    if (t) void addChapter(bookId, t)
  }

  return (
    <aside className="bookdetail__toc" aria-label="章">
      <div className="bookdetail__railHead">
        <span>章</span>
        {!treeLoading && (
          <button
            type="button"
            className="bookdetail__addBtn"
            title="新增章节"
            aria-label="新增章节"
            onClick={() => setAdding(true)}
          >
            ＋
          </button>
        )}
      </div>
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
                    <button
                      type="button"
                      className="bookdetail__delBtn"
                      aria-label="删除章节"
                      title="删除章节"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget({ id: chapter.id, title: chapter.title })
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {adding && (
        <Modal
          title="新增章节"
          onClose={() => {
            setAdding(false)
            setNewTitle('')
          }}
          actions={
            <>
              <button
                type="button"
                className="bookdetail__btn"
                onClick={() => {
                  setAdding(false)
                  setNewTitle('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="bookdetail__primary"
                disabled={newTitle.trim() === ''}
                onClick={commitAdd}
              >
                新增
              </button>
            </>
          }
        >
          <input
            className="bookdetail__modalInput"
            value={newTitle}
            placeholder="输入章节名"
            autoFocus
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitAdd()
              }
            }}
          />
        </Modal>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="删除章节"
        message={
          deleteTarget
            ? `确定删除章节《${deleteTarget.title}》？其段落将一并删除（笔记会保留为自由笔记）。`
            : ''
        }
        confirmLabel="删除"
        onConfirm={() => {
          if (deleteTarget) void deleteChapter(bookId, deleteTarget.id)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </aside>
  )
}

/** Inline chapter title editor: commit on Enter/blur, cancel on Esc. */
function ChapterTitleInput({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
  placeholder?: string
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
      placeholder={placeholder}
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
