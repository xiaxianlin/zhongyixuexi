import { useEffect, useCallback } from 'react'
import { useSessionStore } from '@/stores/session'
import { useAiStore, attachAiProgressListener } from '@/stores/ai'
import { LibraryView } from '@/modules/library/LibraryView'
import { ReadingWorkbench } from '@/modules/reading/ReadingWorkbench'
import { SearchPanel } from '@/modules/search/SearchPanel'
import { SettingsView } from '@/modules/settings/SettingsView'
import { ProviderEditorModal } from '@/modules/settings/ProviderEditorModal'
import { LearningView } from '@/modules/learning/LearningView'
import { NotesView } from '@/modules/notes/NotesView'
import { DegradedNotice } from '@/modules/ai/DegradedNotice'

const NAV: { view: import('@/stores/session').View; label: string }[] = [
  { view: 'library', label: '书库' },
  { view: 'search', label: '检索' },
  { view: 'review', label: '复习' },
  { view: 'notes', label: '笔记' },
  { view: 'settings', label: '设置' },
]

export default function App() {
  const view = useSessionStore((s) => s.view)
  const activeBookId = useSessionStore((s) => s.activeBookId)
  const setView = useSessionStore((s) => s.setView)
  const refreshAiStatus = useAiStore((s) => s.refreshStatus)
  const aiStatus = useAiStore((s) => s.status)

  useEffect(() => {
    const off = attachAiProgressListener()
    void refreshAiStatus()
    return off
  }, [refreshAiStatus])

  // Onboarding gate: force-config an AI provider before the app is usable.
  const showForceSetup = aiStatus !== null && !aiStatus.configured
  const onForceSaved = useCallback(() => {
    void refreshAiStatus()
  }, [refreshAiStatus])

  const reading = view === 'reading' && activeBookId !== null

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
      </header>

      <DegradedNotice />

      <main className="app__main">
        {reading && activeBookId ? (
          <ReadingWorkbench bookId={activeBookId} />
        ) : view === 'search' ? (
          <SearchPanel />
        ) : view === 'review' ? (
          <LearningView />
        ) : view === 'notes' ? (
          <NotesView />
        ) : view === 'settings' ? (
          <SettingsView />
        ) : (
          <LibraryView />
        )}
      </main>

      <ProviderEditorModal mode="force" open={showForceSetup} provider={null} onSaved={onForceSaved} />
    </div>
  )
}
