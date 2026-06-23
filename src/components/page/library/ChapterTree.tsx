/**
 * ChapterTree — left column of BookDetailView (v3.1, business component).
 *
 * Replaces the flat ChapterList with a recursive, collapsible tree that renders
 * the chapter hierarchy (parent_id / level). Each node:
 *   - selects the chapter on click (loads its content into the reading pane)
 *   - shows an "已分析" dot when it (or any descendant) has an active analysis
 *   - exposes ✎ rename, ✕ delete, and ＋ add-child actions
 *   - collapses/expands its subtree (local state, defaults open)
 *
 * Reads tree state + dispatches from useLibraryStore; the store already holds
 * addChapter / addChildChapter / deleteChapter / saveChapterTitle. The root
 * 「＋ 章」 button in the header adds a top-level chapter.
 */
import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '@/models/library/store'
import { Modal } from '@/components/interaction/Modal'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'
import type { ChapterNode } from '@/models/shared/types'

export function ChapterTree({ bookId }: { bookId: string }) {
  const tree = useLibraryStore((s) => s.tree)
  const treeLoading = useLibraryStore((s) => s.treeLoading)
  const selectedChapterId = useLibraryStore((s) => s.selectedChapterId)
  const selectChapter = useLibraryStore((s) => s.selectChapter)
  const addChapter = useLibraryStore((s) => s.addChapter)
  const addChildChapter = useLibraryStore((s) => s.addChildChapter)
  const deleteChapter = useLibraryStore((s) => s.deleteChapter)

  const [addingRoot, setAddingRoot] = useState(false)
  const [newRootTitle, setNewRootTitle] = useState('')
  // Add-child modal target (parentId) — one modal drives all "add child" flows.
  const [addChildTarget, setAddChildTarget] = useState<{ id: string; title: string } | null>(null)
  const [newChildTitle, setNewChildTitle] = useState('')
  // Pending deletion (drives the shared ConfirmModal).
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const commitAddRoot = () => {
    const t = newRootTitle.trim()
    setAddingRoot(false)
    setNewRootTitle('')
    if (t) void addChapter(bookId, t)
  }

  const commitAddChild = () => {
    const t = newChildTitle.trim()
    const target = addChildTarget
    setAddChildTarget(null)
    setNewChildTitle('')
    if (t && target) void addChildChapter(bookId, target.id, t)
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
            onClick={() => setAddingRoot(true)}
          >
            ＋
          </button>
        )}
      </div>
      {treeLoading ? (
        <div className="bookdetail__skeletonList" aria-label="加载目录">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bookdetail__skeletonRow">
              <span className="skeleton skeleton--title" style={{ width: `${50 + (i % 3) * 18}%` }} />
            </div>
          ))}
        </div>
      ) : tree.length === 0 ? (
        <p className="bookdetail__empty">无章节</p>
      ) : (
        <div className="bookdetail__tree">
          {tree.map((chapter) => (
            <ChapterTreeNode
              key={chapter.id}
              bookId={bookId}
              node={chapter}
              depth={0}
              selectedChapterId={selectedChapterId}
              onSelect={selectChapter}
              onAddChild={(node) => {
                setAddChildTarget({ id: node.id, title: node.title })
                setNewChildTitle('')
              }}
              onDelete={(node) => setDeleteTarget({ id: node.id, title: node.title })}
            />
          ))}
        </div>
      )}

      {addingRoot && (
        <Modal
          title="新增章节"
          onClose={() => {
            setAddingRoot(false)
            setNewRootTitle('')
          }}
          actions={
            <>
              <button
                type="button"
                className="bookdetail__btn"
                onClick={() => {
                  setAddingRoot(false)
                  setNewRootTitle('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="bookdetail__primary"
                disabled={newRootTitle.trim() === ''}
                onClick={commitAddRoot}
              >
                新增
              </button>
            </>
          }
        >
          <input
            className="bookdetail__modalInput"
            value={newRootTitle}
            placeholder="输入章节名"
            autoFocus
            onChange={(e) => setNewRootTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitAddRoot()
              }
            }}
          />
        </Modal>
      )}

      {addChildTarget && (
        <Modal
          title={`在《${addChildTarget.title}》下新增小节`}
          onClose={() => {
            setAddChildTarget(null)
            setNewChildTitle('')
          }}
          actions={
            <>
              <button
                type="button"
                className="bookdetail__btn"
                onClick={() => {
                  setAddChildTarget(null)
                  setNewChildTitle('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="bookdetail__primary"
                disabled={newChildTitle.trim() === ''}
                onClick={commitAddChild}
              >
                新增
              </button>
            </>
          }
        >
          <input
            className="bookdetail__modalInput"
            value={newChildTitle}
            placeholder="输入小节名"
            autoFocus
            onChange={(e) => setNewChildTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitAddChild()
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
            ? `确定删除章节《${deleteTarget.title}》？其下小节、正文、摘录将一并删除（笔记会保留为自由笔记）。`
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

/** One recursive tree node. Renders the node row + (when expanded) its children. */
function ChapterTreeNode({
  bookId,
  node,
  depth,
  selectedChapterId,
  onSelect,
  onAddChild,
  onDelete,
}: {
  bookId: string
  node: ChapterNode
  depth: number
  selectedChapterId: string | null
  onSelect: (chapterId: string) => void
  onAddChild: (node: ChapterNode) => void
  onDelete: (node: ChapterNode) => void
}) {
  const editingChapterId = useLibraryStore((s) => s.editingChapterId)
  const chapterDraft = useLibraryStore((s) => s.chapterDraft)
  const startEditChapter = useLibraryStore((s) => s.startEditChapter)
  const cancelEditChapter = useLibraryStore((s) => s.cancelEditChapter)
  const setChapterDraft = useLibraryStore((s) => s.setChapterDraft)
  const saveChapterTitle = useLibraryStore((s) => s.saveChapterTitle)

  const hasChildren = node.children.length > 0
  const [collapsed, setCollapsed] = useState(false)
  const isEditing = editingChapterId === node.id
  const isSelected = node.id === selectedChapterId

  return (
    <div className="bookdetail__treeNode" style={{ '--chapter-depth': depth } as React.CSSProperties}>
      <div
        className={
          isSelected ? 'bookdetail__chapter is-active' : 'bookdetail__chapter'
        }
      >
        {hasChildren ? (
          <button
            type="button"
            className="bookdetail__caret"
            title={collapsed ? '展开' : '折叠'}
            aria-label={collapsed ? '展开' : '折叠'}
            onClick={(e) => {
              e.stopPropagation()
              setCollapsed((c) => !c)
            }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="bookdetail__caret bookdetail__caret--leaf" aria-hidden />
        )}

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
              onClick={() => onSelect(node.id)}
            >
              <span className="bookdetail__name">{node.title}</span>
              {Boolean(node.analyzed) && (
                <span
                  className="bookdetail__chapterDot"
                  aria-label="已分析"
                  title="本章已有 AI 分析"
                />
              )}
            </button>
            <button
              type="button"
              className="bookdetail__addChildBtn"
              aria-label="新增小节"
              title="新增小节"
              onClick={(e) => {
                e.stopPropagation()
                onAddChild(node)
              }}
            >
              ＋
            </button>
            <button
              type="button"
              className="bookdetail__editBtn"
              aria-label="重命名章节"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation()
                startEditChapter(node.id, node.title)
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
                onDelete(node)
              }}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {hasChildren && !collapsed && (
        <div className="bookdetail__treeChildren">
          {node.children.map((child) => (
            <ChapterTreeNode
              key={child.id}
              bookId={bookId}
              node={child}
              depth={depth + 1}
              selectedChapterId={selectedChapterId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
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
