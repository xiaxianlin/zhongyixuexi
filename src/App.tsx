import { useEffect, useCallback, useRef, useState } from 'react'
import { useSessionStore } from '@/stores/session'
import { useAiStore } from '@/stores/ai'
import { useSearchStore } from '@/stores/search'
import { LibraryView } from '@/modules/library/LibraryView'
import { SearchPanel } from '@/modules/search/SearchPanel'
import { SettingsView } from '@/modules/settings/SettingsView'
import { ProviderEditorModal } from '@/modules/settings/ProviderEditorModal'
import { Dashboard } from '@/modules/learning/Dashboard'
import { NotesView } from '@/modules/notes/NotesView'
import { DegradedNotice } from '@/modules/ai/DegradedNotice'

const NAV: { view: import('@/stores/session').View; label: string }[] = [
  { view: 'home', label: '首页' },
  { view: 'library', label: '书库' },
  { view: 'notes', label: '笔记' },
  { view: 'settings', label: '设置' },
]

export default function App() {
  const view = useSessionStore((s) => s.view)
  const setView = useSessionStore((s) => s.setView)
  const refreshAiStatus = useAiStore((s) => s.refreshStatus)
  const aiStatus = useAiStore((s) => s.status)
  const searchQuery = useSearchStore((s) => s.query)
  const runSearch = useSearchStore((s) => s.runSearch)
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [quickSearchDraft, setQuickSearchDraft] = useState('')
  const quickSearchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void refreshAiStatus()
  }, [refreshAiStatus])

  const showForceSetup = aiStatus !== null && !aiStatus.configured
  const onForceSaved = useCallback(() => {
    void refreshAiStatus()
  }, [refreshAiStatus])

  const openQuickSearch = useCallback(() => {
    setQuickSearchDraft(searchQuery)
    setQuickSearchOpen(true)
  }, [searchQuery])

  const closeQuickSearch = useCallback(() => {
    setQuickSearchOpen(false)
  }, [])

  useEffect(() => {
    if (!quickSearchOpen) return
    quickSearchInputRef.current?.focus()
    quickSearchInputRef.current?.select()
  }, [quickSearchOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openQuickSearch()
      } else if (event.key === 'Escape') {
        closeQuickSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeQuickSearch, openQuickSearch])

  const submitQuickSearch = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const query = quickSearchDraft.trim()
      if (!query) return
      void runSearch(query)
      setView('search')
      closeQuickSearch()
    },
    [closeQuickSearch, quickSearchDraft, runSearch, setView],
  )

  useEffect(() => {
    document.body.dataset.view = view
    return () => {
      delete document.body.dataset.view
    }
  }, [view])

  return (
    <div className="app">
      <header className="app__header">
        <h1>中医经典学习</h1>
        <nav className="app__nav">
          {NAV.map((n) => (
            <button
              key={n.view}
              className={view === n.view ? 'app__navBtn is-active' : 'app__navBtn'}
              onClick={() => setView(n.view)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="app__searchBtn"
          onClick={openQuickSearch}
          aria-label="快速检索"
          title="快速检索"
        >
          <span className="app__searchIcon" aria-hidden>
            ⌕
          </span>
        </button>
      </header>

      <DegradedNotice />

      <main className="app__main">
        {view === 'search' ? (
          <SearchPanel />
        ) : view === 'notes' ? (
          <NotesView />
        ) : view === 'settings' ? (
          <SettingsView />
        ) : view === 'library' ? (
          <LibraryView />
        ) : (
          <Dashboard />
        )}
      </main>

      <ProviderEditorModal mode="force" open={showForceSetup} provider={null} onSaved={onForceSaved} />

      {quickSearchOpen && (
        <div className="quicksearch" role="dialog" aria-modal="true" aria-label="快速检索">
          <button
            type="button"
            className="quicksearch__backdrop"
            aria-label="关闭快速检索"
            onClick={closeQuickSearch}
          />
          <form className="quicksearch__panel" onSubmit={submitQuickSearch}>
            <div className="quicksearch__icon" aria-hidden>
              ⌕
            </div>
            <input
              ref={quickSearchInputRef}
              className="quicksearch__input"
              value={quickSearchDraft}
              onChange={(event) => setQuickSearchDraft(event.target.value)}
              placeholder="检索书中原文、白话、医理、笔记"
            />
            <button type="submit" className="quicksearch__submit">
              回车
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
