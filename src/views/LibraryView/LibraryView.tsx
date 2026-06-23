/**
 * LibraryView — entry point for the 书库 (library) route. Routes between:
 *   - empty state (books still loading / built-in initializing)
 *   - book grid (no bookId in URL)
 *   - BookDetailView (bookId in URL)
 *
 * Pure View: state/logic live in useLibraryStore + the page components under
 * components/page/library/. This file is the router shell + book grid.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { libraryApi } from '@/models/library/api'
import { useLibraryStore } from '@/models/library/store'
import { Modal } from '@/components/interaction/Modal'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'
import type { BookListItem } from '@/models/shared/types'
import { BookDetailView } from './BookDetailView'
import './library.css'

export function LibraryView() {
  const { bookId, chapterId } = useParams<{ bookId?: string; chapterId?: string }>()
  const navigate = useNavigate()
  const [books, setBooks] = useState<BookListItem[]>([])
  const selectedBook = bookId ? (books.find((b) => b.id === bookId) ?? null) : null

  const refresh = useCallback(async () => {
    setBooks(await libraryApi.list())
  }, [])

  useEffect(() => {
    document.body.classList.toggle('is-library-detail', selectedBook !== null)
    return () => {
      document.body.classList.remove('is-library-detail')
    }
  }, [selectedBook])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      setBooks((prev) => {
        const oldIndex = prev.findIndex((b) => b.id === active.id)
        const newIndex = prev.findIndex((b) => b.id === over.id)
        if (oldIndex === -1 || newIndex === -1) return prev
        const next = arrayMove(prev, oldIndex, newIndex)
        // persist the new order; ignore errors (next render re-syncs via refresh)
        void libraryApi.reorder(next.map((b) => b.id)).catch(() => void refresh())
        return next
      })
    },
    [refresh],
  )

  const uploadCover = useCallback(
    async (bookId: string) => {
      // setBookCover returns null (user cancelled) by throwing nothing; the IPC
      // always returns the refreshed book list either way.
      const refreshed = await libraryApi.uploadCover(bookId)
      setBooks(refreshed)
    },
    [],
  )

  const addBook = useLibraryStore((s) => s.addBook)
  const deleteBook = useLibraryStore((s) => s.deleteBook)

  // 「新建书籍」弹窗：用自定义 modal 替代 window.prompt（与应用风格一致）
  const [newBookOpen, setNewBookOpen] = useState(false)
  const [newBookTitle, setNewBookTitle] = useState('')
  const [bookSaving, setBookSaving] = useState(false)

  const openNewBook = useCallback(() => {
    setNewBookTitle('')
    setNewBookOpen(true)
  }, [])

  const closeNewBook = useCallback(() => {
    setNewBookOpen(false)
    setNewBookTitle('')
  }, [])

  const submitNewBook = useCallback(async () => {
    const title = newBookTitle.trim()
    if (!title) return
    setBookSaving(true)
    try {
      const created = await addBook(title)
      if (created) {
        setNewBookOpen(false)
        setNewBookTitle('')
        await refresh()
      }
    } finally {
      setBookSaving(false)
    }
  }, [addBook, newBookTitle, refresh])

  // 删书二次确认：本地 state 持待删书，复用全局 ConfirmModal（替代 window.confirm）
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const confirmDeleteBook = useCallback(async () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target) return
    const ok = await deleteBook(target.id)
    if (ok) await refresh()
  }, [deleteBook, deleteTarget, refresh])

  return (
    <div className="lib">
      {books.length === 0 ? (
        <div className="lib__emptyState">
          <div className="lib__emptyIcon" aria-hidden>
            卷
          </div>
          <p className="lib__emptyDesc">内置《黄帝八十一难经》正在初始化</p>
        </div>
      ) : selectedBook ? (
        <BookDetailView
          book={selectedBook}
          targetChapterId={chapterId ?? null}
          onBack={() => navigate('/library')}
          onBookUpdated={() => void refresh()}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={books.map((b) => b.id)} strategy={rectSortingStrategy}>
            <div className="lib__grid">
              {books.map((b) => (
                <BookCard
                  key={b.id}
                  book={b}
                  onOpen={() => navigate(`/book/${b.id}`)}
                  onUploadCover={() => void uploadCover(b.id)}
                  onDelete={() => setDeleteTarget({ id: b.id, title: b.title })}
                />
              ))}
              <button
                type="button"
                className="bookcard bookcard--new"
                onClick={openNewBook}
                title="新建书籍"
              >
                <span className="bookcard__plus" aria-hidden>
                  ＋
                </span>
                <span className="bookcard__newLabel">新建书籍</span>
              </button>
            </div>
          </SortableContext>
        </DndContext>
      )}

      {newBookOpen && (
        <NewBookModal
          value={newBookTitle}
          saving={bookSaving}
          onChange={setNewBookTitle}
          onSubmit={() => void submitNewBook()}
          onClose={closeNewBook}
        />
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="删除书籍"
        message={
          deleteTarget
            ? `确定删除《${deleteTarget.title}》？其章节、段落将一并删除（笔记会保留为自由笔记）。`
            : ''
        }
        confirmLabel="删除"
        onConfirm={() => void confirmDeleteBook()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/** Sortable book card — shows the cover image if set, else the title. A hover
 *  「换封面」 button opens the OS file picker; the click is stopped so it doesn't
 *  also open the book. */
function BookCard({
  book,
  onOpen,
  onUploadCover,
  onDelete,
}: {
  book: BookListItem
  onOpen: () => void
  onUploadCover: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: book.id,
  })
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? 'bookcard is-dragging' : 'bookcard'}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
      {book.cover ? (
        <img className="bookcard__coverImg" src={book.cover} alt={book.title} draggable={false} />
      ) : (
        <div className="bookcard__titleOnly">{book.title}</div>
      )}
      <button
        type="button"
        className="bookcard__coverBtn"
        title="换封面"
        aria-label="换封面"
        onClick={(e) => {
          e.stopPropagation()
          onUploadCover()
        }}
      >
        {book.cover ? '换' : '＋'}
      </button>
      <button
        type="button"
        className="bookcard__delBtn"
        title="删除书籍"
        aria-label="删除书籍"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        ✕
      </button>
      <span
        className={
          book.category === 'classic'
            ? 'bookcard__catBadge bookcard__catBadge--classic'
            : 'bookcard__catBadge bookcard__catBadge--modern'
        }
      >
        {book.category === 'classic' ? '古' : '现'}
      </span>
      {book.cover && <div className="bookcard__titleOverlay">{book.title}</div>}
    </div>
  )
}

/** 「新建书籍」弹窗 — 复用通用 Modal 壳，书名输入 + 新建/取消。
 *  Modal 统一处理 Esc / × / 背景点击关闭；这里只管输入与提交。 */
function NewBookModal({
  value,
  saving,
  onChange,
  onSubmit,
  onClose,
}: {
  value: string
  saving: boolean
  onChange: (v: string) => void
  onSubmit: () => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  return (
    <Modal
      title="新建书籍"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="bookdetail__btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="button"
            className="bookdetail__primary"
            disabled={saving || value.trim() === ''}
            onClick={onSubmit}
          >
            {saving ? '保存中' : '新建'}
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        className="bookdetail__modalInput"
        value={value}
        placeholder="输入书名"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
    </Modal>
  )
}
