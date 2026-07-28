import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'

interface SearchHit {
  paragraphId: string
  chapterId: string
  bookId: string
  text: string
}

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    try {
      const res = await apiFetch<{ hits: SearchHit[] }>(`/search?q=${encodeURIComponent(query)}`)
      setHits(res.hits)
    } catch (err) {
      setError(err instanceof Error ? err.message : '检索失败')
    }
  }

  return (
    <div>
      <h1>全文检索</h1>
      <form onSubmit={handleSubmit}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索原文…" />
        <button type="submit">检索</button>
      </form>
      {error && <p className="error">{error}</p>}
      {hits && hits.length === 0 && <p className="hint">未找到匹配段落。</p>}
      <ul>
        {hits?.map((hit) => (
          <li key={hit.paragraphId}>
            <Link to={`/books/${hit.bookId}`}>{hit.text}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
