import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'

interface Book {
  id: string
  title: string
  author: string | null
  category: string | null
}

export default function LibraryPage() {
  const [books, setBooks] = useState<Book[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<{ books: Book[] }>('/books')
      .then((res) => setBooks(res.books))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }, [])

  return (
    <div>
      <h1>书库</h1>
      {error && <p className="error">{error}</p>}
      {!books && !error && <p className="hint">加载中…</p>}
      {books && books.length === 0 && <p className="hint">暂无已发布的经典。</p>}
      <ul className="lib__grid">
        {books?.map((book) => (
          <li key={book.id}>
            <Link to={`/books/${book.id}`} className="bookcard">
              {book.category && <span className="bookcard__category">{book.category}</span>}
              <span className="bookcard__title">{book.title}</span>
              {book.author && <span className="bookcard__author">{book.author}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
