import { useUiStore } from '@/stores/ui'
import { useSessionStore } from '@/stores/session'
import { LibraryView } from '@/modules/library/LibraryView'
import { ReadingWorkbench } from '@/modules/reading/ReadingWorkbench'
import { SearchPanel } from '@/modules/search/SearchPanel'

export default function App() {
  const theme = useUiStore((s) => s.theme)
  const cycleTheme = useUiStore((s) => s.cycleTheme)
  const view = useSessionStore((s) => s.view)
  const activeBookId = useSessionStore((s) => s.activeBookId)
  const setView = useSessionStore((s) => s.setView)

  const reading = view === 'reading' && activeBookId !== null

  return (
    <div className="app">
      <header className="app__header">
        <h1>中医经典学习</h1>
        <nav className="app__nav">
          <button
            className={view === 'library' ? 'app__navBtn is-active' : 'app__navBtn'}
            onClick={() => setView('library')}
          >
            书库
          </button>
          <button
            className={view === 'search' ? 'app__navBtn is-active' : 'app__navBtn'}
            onClick={() => setView('search')}
          >
            检索
          </button>
        </nav>
        <button
          className="app__themeBtn"
          onClick={cycleTheme}
          title="切换主题"
          aria-label="切换主题"
        >
          {theme === 'paper' ? '白' : theme === 'ink' ? '墨' : '夜'}
        </button>
      </header>

      <main className="app__main">
        {reading && activeBookId ? (
          <ReadingWorkbench bookId={activeBookId} />
        ) : view === 'search' ? (
          <SearchPanel />
        ) : (
          <LibraryView />
        )}
      </main>
    </div>
  )
}
