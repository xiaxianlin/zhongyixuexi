/**
 * AnalysisRail — right column of BookDetailView (v3.1, 析).
 *
 * A vertical 6-tab rail: 对话 / 解读 / 医理 / 白话 / 笔记 / 摘录. The tab head
 * sits on the RIGHT edge with vertical text (writing-mode: vertical-rl); the
 * active tab gets a left color bar. Default tab is 对话 (D5 wires the chat
 * surface; until then it shows a placeholder).
 *
 *  - 解读 / 医理 / 白话: read the active chapter-level analysis
 *    (chapterContent.analysis). 白话 is hidden for modern books.
 *  - 摘录: the current chapter's selection highlights (ExcerptsTab).
 *  - 对话 (D5) / 笔记 (D6): placeholders until those slices land.
 */
import { useLibraryStore } from '@/models/library/store'
import { compactAnalysisText } from '@/models/library/helpers'
import { ExcerptsTab } from './rail/ExcerptsTab'
import { ChatTab } from './rail/ChatTab'
import type { BookListItem } from '@/models/shared/types'

type TabKey = 'chat' | 'analysis' | 'explanation' | 'modern' | 'notes' | 'excerpts'

interface TabDef {
  key: TabKey
  label: string
  /** Show only for classic books (used by 白话). */
  classicOnly?: boolean
}

const TABS: TabDef[] = [
  { key: 'chat', label: '对话' },
  { key: 'analysis', label: '解读' },
  { key: 'explanation', label: '医理' },
  { key: 'modern', label: '白话', classicOnly: true },
  { key: 'notes', label: '笔记' },
  { key: 'excerpts', label: '摘录' },
]

export function AnalysisRail({ book }: { book: BookListItem | null }) {
  const active = useLibraryStore((s) => s.activeRailTab)
  const setActive = useLibraryStore((s) => s.setActiveRailTab)
  const chapterContent = useLibraryStore((s) => s.chapterContent)
  const excerpts = useLibraryStore((s) => s.excerpts)
  const isClassic = (book?.category ?? 'modern') === 'classic'

  const visibleTabs = TABS.filter((t) => !t.classicOnly || isClassic)
  const analysis = chapterContent?.analysis ?? null

  return (
    <aside className="bookdetail__inspector bookdetail__rail" aria-label="析">
      <div className="bookdetail__railBody">
        <div className="bookdetail__railPane">
          {active === 'chat' && <ChatTab />}
          {active === 'analysis' && (
            <InterpBlock title="解读" text={analysis?.analysis} />
          )}
          {active === 'explanation' && (
            <InterpBlock title="医理" text={analysis?.explanation} />
          )}
          {active === 'modern' && isClassic && (
            <InterpBlock title="白话" text={analysis?.modern} />
          )}
          {active === 'notes' && (
            <p className="railtab__empty">选区笔记将在下一版本上线。</p>
          )}
          {active === 'excerpts' && (
            <>
              <div className="bookdetail__panelTitle">摘录（{excerpts.length}）</div>
              <ExcerptsTab />
            </>
          )}
        </div>
        <nav className="bookdetail__railTabs" aria-label="析 标签">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={
                active === t.key
                  ? 'bookdetail__railTab is-active'
                  : 'bookdetail__railTab'
              }
              onClick={() => setActive(t.key)}
            >
              <span className="bookdetail__railTabText">{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}

/** One interpretation block: title + prose, or a muted placeholder. */
function InterpBlock({ title, text }: { title: string; text: string | null | undefined }) {
  return (
    <section className="bookdetail__panelBlock">
      <div className="bookdetail__panelTitle">{title}</div>
      {text ? (
        <p className="bookdetail__analysisText">{compactAnalysisText(text)}</p>
      ) : (
        <p className="bookdetail__muted">本章尚未解读（点阅读区「AI 分析」生成）</p>
      )}
    </section>
  )
}
