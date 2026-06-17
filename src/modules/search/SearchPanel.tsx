import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchStore } from '@/stores/search'
import { ResultList } from './ResultList'
import './search.css'

const DEBOUNCE_MS = 250

export function SearchPanel() {
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
