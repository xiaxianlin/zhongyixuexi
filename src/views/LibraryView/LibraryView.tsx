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
import { libraryApi } from '@/models/library/api'
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
        />
      ) : (
        <div className="lib__grid">
          {books.map((b) => (
            <div
              key={b.id}
              className="bookcard"
              onClick={() => navigate(`/book/${b.id}`)}
            >
              <div className="bookcard__cover">{b.title.slice(0, 1)}</div>
              <div className="bookcard__body">
                <div className="bookcard__title">{b.title}</div>
                <div className="bookcard__meta">
                  {b.author || '佚名'} · {b.chapter_count} 章 · {b.paragraph_count} 段
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
