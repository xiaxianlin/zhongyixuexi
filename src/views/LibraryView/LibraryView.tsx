/**
 * LibraryView — entry point for the 书库 (library) route. Routes between:
 *   - empty state (books still loading / built-in initializing)
 *   - book grid (no bookId in URL)
 *   - BookDetailView (bookId in URL)
 *
 * Pure View: state/logic live in useLibraryStore + the page components under
 * components/page/library/. This file is the router shell + book grid.
 */
import { useCallback, useEffect, useState } from 'react'
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

  const handleAddBook = useCallback(async () => {
    const title = window.prompt('新书书名')
    if (!title) return
    const created = await addBook(title.trim())
    if (created) await refresh()
  }, [addBook, refresh])

  const handleDeleteBook = useCallback(
    async (bookId: string, title: string) => {
      if (!window.confirm(`确定删除《${title}》？其章节、段落将一并删除（笔记会保留为自由笔记）。`)) return
      const ok = await deleteBook(bookId)
      if (ok) await refresh()
    },
    [deleteBook, refresh],
  )

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
                  onDelete={() => void handleDeleteBook(b.id, b.title)}
                />
              ))}
              <button
                type="button"
                className="bookcard bookcard--new"
                onClick={() => void handleAddBook()}
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
      {book.cover && <div className="bookcard__titleOverlay">{book.title}</div>}
    </div>
  )
}
