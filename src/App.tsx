import { useEffect, useCallback } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useAiStore } from '@/stores/ai'
import { LibraryView } from '@/modules/library/LibraryView'
import { SettingsView } from '@/modules/settings/SettingsView'
import { SearchPanel } from '@/modules/search/SearchPanel'
import { ProviderEditorModal } from '@/modules/settings/ProviderEditorModal'
import { DegradedNotice } from '@/modules/ai/DegradedNotice'

const NAV_LINKS = [
  { to: '/', label: '书库', end: true },
  { to: '/search', label: '检索', end: false },
  { to: '/settings', label: '设置', end: false },
] as const

function Shell() {
  const refreshAiStatus = useAiStore((s) => s.refreshStatus)
  const aiStatus = useAiStore((s) => s.status)

  useEffect(() => {
    void refreshAiStatus()
  }, [refreshAiStatus])

  const showForceSetup = aiStatus !== null && !aiStatus.configured
  const onForceSaved = useCallback(() => void refreshAiStatus(), [refreshAiStatus])

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
      </header>

      <DegradedNotice />

      <main className="app__main">
        <Routes>
          <Route path="/" element={<LibraryView />} />
          <Route path="/book/:bookId" element={<LibraryView />} />
          <Route path="/book/:bookId/chapter/:chapterId" element={<LibraryView />} />
          <Route path="/settings" element={<SettingsView />} />
          <Route path="/search" element={<SearchPanel />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <ProviderEditorModal mode="force" open={showForceSetup} provider={null} onSaved={onForceSaved} />
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
