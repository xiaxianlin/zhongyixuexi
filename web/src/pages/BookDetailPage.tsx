import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'

interface ChapterNode {
  id: string
  title: string
  orderIndex: number
  children: ChapterNode[]
}

interface Paragraph {
  id: string
  orderIndex: number
  text: string
}

interface BookDetail {
  book: { id: string; title: string; author: string | null }
  chapters: ChapterNode[]
  paragraphsByChapter: Record<string, Paragraph[]>
}

export default function BookDetailPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const [detail, setDetail] = useState<BookDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bookId) return
    apiFetch<BookDetail>(`/books/${bookId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }, [bookId])

  if (error) return <p className="error">{error}</p>
  if (!detail) return <p>加载中…</p>

  return (
    <div>
      <h1>{detail.book.title}</h1>
      {detail.book.author && <p className="hint">{detail.book.author}</p>}
      {detail.chapters.map((chapter) => (
        <ChapterBlock key={chapter.id} chapter={chapter} paragraphsByChapter={detail.paragraphsByChapter} />
      ))}
    </div>
  )
}

function ChapterBlock({
  chapter,
  paragraphsByChapter,
}: {
  chapter: ChapterNode
  paragraphsByChapter: Record<string, Paragraph[]>
}) {
  const paragraphs = paragraphsByChapter[chapter.id] ?? []
  return (
    <section className="chapter">
      <h2>{chapter.title}</h2>
      {paragraphs.map((p) => (
        <p key={p.id} className="paragraph">
          {p.text}
        </p>
      ))}
      {chapter.children.map((child) => (
        <ChapterBlock key={child.id} chapter={child} paragraphsByChapter={paragraphsByChapter} />
      ))}
    </section>
  )
}
