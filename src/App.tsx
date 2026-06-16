import { useEffect, useState } from 'react'
import { useUiStore } from '@/stores/ui'
import { useSessionStore } from '@/stores/session'
import { LibraryView } from '@/modules/library/LibraryView'
import { ChapterTree } from '@/modules/library/ChapterTree'
import { SegmentEditor } from '@/modules/library/SegmentEditor'

export default function App() {
  const theme = useUiStore((s) => s.theme)
  const cycleTheme = useUiStore((s) => s.cycleTheme)
  const view = useSessionStore((s) => s.view)
  const activeBookId = useSessionStore((s) => s.activeBookId)
  const setView = useSessionStore((s) => s.setView)

  const [chapterId, setChapterId] = useState<string | null>(null)

  // reset chapter selection when the open book changes
  useEffect(() => {
    setChapterId(null)
  }, [activeBookId])

  const reading = view === 'reading' && activeBookId !== null

  return (
    <div className="app">
      <header className="app__header">
        <h1>中医经典学习</h1>
        {reading && (
          <button
            className="app__back"
            onClick={() => {
              setChapterId(null)
              setView('library')
            }}
          >
            ← 书库
          </button>
        )}
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
          <div className="reader">
            <div className="reader__sidebar">
              <ChapterTree bookId={activeBookId} onSelect={setChapterId} />
            </div>
            <div className="reader__main">
              {chapterId ? (
                <SegmentEditor chapterId={chapterId} />
              ) : (
                <p className="reader__placeholder">
                  从左侧选择一章进行段级校对。阅读三栏模块将在 Phase 2 接入。
                </p>
              )}
            </div>
          </div>
        ) : (
          <LibraryView />
        )}
      </main>
    </div>
  )
}
