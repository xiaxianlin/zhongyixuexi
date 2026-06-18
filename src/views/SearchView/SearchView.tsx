/**
 * SearchView — the 检索 (search) route. Debounced input bound to the search
 * store, plus the result list (page component). Pure View; state/logic live in
 * useSearchStore (Model) and components/page/search/ResultList.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSearchStore } from '@/models/search/store'
import { ResultList } from '@/components/page/search/ResultList'
import './search.css'

const DEBOUNCE_MS = 250

export function SearchView() {
  const navigate = useNavigate()
  const query = useSearchStore((s) => s.query)
  const runSearch = useSearchStore((s) => s.runSearch)
  const clear = useSearchStore((s) => s.clear)
  const [draft, setDraft] = useState(query)

  // Keep the input in sync if the store query changes elsewhere (e.g. cleared).
  useEffect(() => {
    setDraft(query)
  }, [query])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRun = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void runSearch(q)
      }, DEBOUNCE_MS)
    },
    [runSearch],
  )

  // Clean up any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value
      setDraft(v)
      debouncedRun(v)
    },
    [debouncedRun],
  )

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (timer.current) clearTimeout(timer.current)
      void runSearch(draft)
    },
    [draft, runSearch],
  )

  const onClear = useCallback(() => {
    setDraft('')
    if (timer.current) clearTimeout(timer.current)
    clear()
  }, [clear])

  return (
    <section className="search">
      <form className="search__bar" onSubmit={onSubmit}>
        <button
          type="button"
          className="bookdetail__back search__back"
          onClick={() => navigate(-1)}
          title="返回"
          aria-label="返回"
        />
        <input
          className="search__input"
          type="search"
          value={draft}
          placeholder="检索全书库（≥3 字走索引，短词走精确扫描）"
          autoFocus
          onChange={onChange}
        />
        {draft && (
          <button type="button" className="search__clear" onClick={onClear} aria-label="清空">
            ×
          </button>
        )}
      </form>

      <ResultList />
    </section>
  )
}
