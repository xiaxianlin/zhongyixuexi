import { useEffect, useCallback, useRef, useState } from 'react'
import {
  HashRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useAiStore } from '@/models/ai/store'
import { useSearchStore } from '@/models/search/store'
import { LibraryView } from '@/views/LibraryView/LibraryView'
import { SettingsView } from '@/views/SettingsView/SettingsView'
import { SearchView } from '@/views/SearchView/SearchView'
import { LearningView } from '@/views/LearningView/LearningView'
import { ProviderEditorModal } from '@/components/global/ProviderEditorModal'
import { DegradedNotice } from '@/components/global/DegradedNotice'

// Search is not in the main nav — it's entered via the header ⌕ button /
// quicksearch overlay (Cmd/Ctrl+K), matching the original interaction.
// Learning is the default landing route (/, no tab); Library lives at /library.
const NAV_LINKS = [
  { to: '/library', label: '书库', end: false },
  { to: '/settings', label: '设置', end: false },
] as const

function Shell() {
  const navigate = useNavigate()
  const location = useLocation()
  const refreshAiStatus = useAiStore((s) => s.refreshStatus)
  const aiStatus = useAiStore((s) => s.status)
  const searchQuery = useSearchStore((s) => s.query)
  const runSearch = useSearchStore((s) => s.runSearch)
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [quickSearchDraft, setQuickSearchDraft] = useState('')
  const quickSearchInputRef = useRef<HTMLInputElement | null>(null)

  // Sync body[data-view] from the current route. main.css keys header/main
  // layout off this attribute (e.g. body[data-view='search'] hides the header
  // and applies search padding).
  useEffect(() => {
    const isSearch = location.pathname === '/search'
    if (isSearch) {
      document.body.dataset.view = 'search'
    } else if (document.body.dataset.view) {
      delete document.body.dataset.view
    }
  }, [location.pathname])

  useEffect(() => {
    void refreshAiStatus()
  }, [refreshAiStatus])

  const showForceSetup = aiStatus !== null && !aiStatus.configured
  const onForceSaved = useCallback(() => void refreshAiStatus(), [refreshAiStatus])

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
      closeQuickSearch()
      navigate('/search')
    },
    [closeQuickSearch, navigate, quickSearchDraft, runSearch],
  )

  return (
    <div className="app">
      <header className="app__header">
        <h1>中医经典学习</h1>
        <nav className="app__nav">
          {NAV_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                isActive ? 'app__navBtn is-active' : 'app__navBtn'
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="app__searchBtn"
          onClick={openQuickSearch}
          aria-label="快速检索"
          title="快速检索 (Ctrl/Cmd+K)"
        >
          <span className="app__searchIcon" aria-hidden>
            ⌕
          </span>
        </button>
      </header>

      <DegradedNotice />

      <main className="app__main">
        <Routes>
          <Route path="/" element={<LearningView />} />
          <Route path="/library" element={<LibraryView />} />
          <Route path="/book/:bookId" element={<LibraryView />} />
          <Route path="/book/:bookId/chapter/:chapterId" element={<LibraryView />} />
          <Route path="/search" element={<SearchView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
