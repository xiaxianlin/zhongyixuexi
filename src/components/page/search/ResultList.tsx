/**
 * ResultList — search result list (business component, page-level).
 *
 * Chapter-level results with snippet highlight + click-to-jump. Reads
 * result/loading/error from the search store; ResultItem navigates via
 * react-router + sets a one-shot match offset in the session store so the
 * reading pane scrolls to the hit on open.
 */
import { useNavigate } from 'react-router-dom'
import { useSearchStore } from '@/models/search/store'
import { useSessionStore } from '@/models/shared/session'
import { parseSnippet } from '@/models/search/snippet'
import type { SearchHit } from '@/models/search/types'

/** Renders a search hit's snippet: <mark> spans become highlighted nodes. */
function Snippet({ html }: { html: string }) {
  const segments = parseSnippet(html)
  return (
    <span className="result__snippet">
      {segments.map((s, i) =>
        s.mark ? (
          <mark className="result__mark" key={i}>
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  )
}

function ResultItem({ hit }: { hit: SearchHit }) {
  const navigate = useNavigate()
  const setPendingMatchOffset = useSessionStore((s) => s.setPendingMatchOffset)
  return (
    <li
      className="result"
      onClick={() => {
        setPendingMatchOffset(hit.matchOffset >= 0 ? hit.matchOffset : null)
        navigate(`/book/${hit.bookId}/chapter/${hit.chapterId}`)
      }}
    >
      <div className="result__head">
        <span className="result__book">{hit.bookTitle}</span>
        <span className="result__sep">›</span>
        <span className="result__chapter">{hit.chapterTitle}</span>
      </div>
      <Snippet html={hit.snippet} />
    </li>
  )
}

export function ResultList() {
  const result = useSearchStore((s) => s.result)
  const loading = useSearchStore((s) => s.loading)
  const error = useSearchStore((s) => s.error)

  if (loading) return <p className="search__status">检索中…</p>
  if (error) return <p className="search__status search__status--err">检索失败：{error}</p>
  if (!result) return null

  if (result.hits.length === 0) {
    return <p className="search__status">无匹配结果。</p>
  }

  return (
    <div className="results">
      <div className="results__meta">
        共 {result.total} 条命中
        {result.degraded && <span className="results__hint"> · 短词已用精确扫描</span>}
      </div>
      <ul className="results__list">
        {result.hits.map((h) => (
          <ResultItem key={`${h.chapterId}:${h.matchOffset}`} hit={h} />
        ))}
      </ul>
    </div>
  )
}
