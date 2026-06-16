import { useEffect, useState, useCallback } from 'react'
import { useSessionStore } from '@/stores/session'
import { useAiStore, attachAiProgressListener } from '@/stores/ai'
import { LibraryView } from '@/modules/library/LibraryView'
import { ReadingWorkbench } from '@/modules/reading/ReadingWorkbench'
import { SearchPanel } from '@/modules/search/SearchPanel'
import { SettingsView } from '@/modules/settings/SettingsView'
import { ProviderEditorModal } from '@/modules/settings/ProviderEditorModal'
import { LearningView } from '@/modules/learning/LearningView'
import { NotesView } from '@/modules/notes/NotesView'
import { QaPanel } from '@/modules/ai/QaPanel'
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
  const setActiveParagraph = useSessionStore((s) => s.setActiveParagraph)
  const setView = useSessionStore((s) => s.setView)
  const refreshAiStatus = useAiStore((s) => s.refreshStatus)
  const aiStatus = useAiStore((s) => s.status)

  const [qaOpen, setQaOpen] = useState(false)

  useEffect(() => {
    const off = attachAiProgressListener()
    void refreshAiStatus()
    return off
  }, [refreshAiStatus])

  // Onboarding gate: force-config an AI provider before the app is usable.
  // Only shown once the status probe has resolved (status !== null) and the
  // active provider has no key. The force modal auto-activates on save, so
  // refreshing the status flips this off and dismisses it.
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

      <QaPanel
        open={qaOpen}
        onClose={() => setQaOpen(false)}
        bookId={activeBookId}
        onCite={(pid) => setActiveParagraph(pid)}
      />

      <button
        type="button"
        className={qaOpen ? 'app__qaFab is-hidden' : 'app__qaFab'}
        onClick={() => setQaOpen(true)}
        title="AI 智能问答"
        aria-label="打开智能问答"
        aria-hidden={qaOpen}
        tabIndex={qaOpen ? -1 : 0}
      >
        问
      </button>

      <ProviderEditorModal mode="force" open={showForceSetup} provider={null} onSaved={onForceSaved} />
    </div>
  )
}
