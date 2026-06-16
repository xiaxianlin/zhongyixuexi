/**
 * Learning module main view (LRN — 04-learning.md §6.1).
 *
 * Tabbed interface: DailyPlan (复习计划 + 翻卡), Dashboard (学习仪表盘),
 * Quiz (测验). Entry point for the `review` view in session store.
 */

import { useCallback, useEffect, useState } from 'react'
import { learningApi } from '@/lib/learning-api'
import { FlashcardView } from './FlashcardView'
import { Dashboard } from './Dashboard'
import { QuizView } from './QuizView'
import type { ReviewMode } from './types'
import './learning.css'

type Tab = 'plan' | 'flashcard' | 'dashboard' | 'quiz'

export function LearningView() {
  const [tab, setTab] = useState<Tab>('plan')
  const [dueCount, setDueCount] = useState(0)
  const [mode, setMode] = useState<ReviewMode>('today')

  const refreshDue = useCallback(async () => {
    try {
      const queue = await learningApi.getDueQueue({ mode: 'today' })
      setDueCount(queue.length)
    } catch {
      setDueCount(0)
    }
  }, [])

  useEffect(() => {
    void refreshDue()
  }, [refreshDue])

  const startReview = (m: ReviewMode) => {
    setMode(m)
    setTab('flashcard')
  }

  if (tab === 'flashcard') {
    return <FlashcardView mode={mode} onExit={() => { setTab('plan'); void refreshDue() }} />
  }

  return (
    <div className="learning">
      <div className="learning__tabs">
        <button
          className={`learning__tab ${tab === 'plan' ? 'learning__tab--active' : ''}`}
          onClick={() => setTab('plan')}
        >
          复习计划
        </button>
        <button
          className={`learning__tab ${tab === 'dashboard' ? 'learning__tab--active' : ''}`}
          onClick={() => setTab('dashboard')}
        >
          学习仪表盘
        </button>
        <button
          className={`learning__tab ${tab === 'quiz' ? 'learning__tab--active' : ''}`}
          onClick={() => setTab('quiz')}
        >
          测验
        </button>
      </div>

      {tab === 'plan' && (
        <DailyPlan dueCount={dueCount} onStart={startReview} onRefresh={refreshDue} />
      )}
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'quiz' && <QuizView />}
    </div>
  )
}

function DailyPlan({
  dueCount,
  onStart,
  onRefresh,
}: {
  dueCount: number
  onStart: (mode: ReviewMode) => void
  onRefresh: () => void
}) {
  return (
    <div className="daily-plan">
      <div className="daily-plan__hero">
        <div className="daily-plan__count">
          <span className="daily-plan__number">{dueCount}</span>
          <span className="daily-plan__label">今日待复习</span>
        </div>
        <button className="daily-plan__refresh" onClick={onRefresh} title="刷新">
          ↻
        </button>
      </div>

      <div className="daily-plan__modes">
        <button
          className="daily-plan__start"
          disabled={dueCount === 0}
          onClick={() => onStart('today')}
        >
          开始今日复习
        </button>
        <button className="daily-plan__mode" onClick={() => onStart('all')}>
          全部卡片
        </button>
        <button className="daily-plan__mode" onClick={() => onStart('random')}>
          随机复习
        </button>
      </div>

      {dueCount === 0 && (
        <p className="daily-plan__empty">
          今日已完成所有复习。试试「随机复习」或去「测验」挑战自己。
        </p>
      )}

      <div className="daily-plan__shortcuts">
        <h4>快捷键</h4>
        <ul>
          <li><kbd>Space</kbd> 翻面</li>
          <li><kbd>1</kbd> 重来 · <kbd>2</kbd> 困难 · <kbd>3</kbd> 良好 · <kbd>4</kbd> 简单</li>
          <li><kbd>Ctrl+Z</kbd> 撤销 · <kbd>Esc</kbd> 退出</li>
        </ul>
      </div>
    </div>
  )
}
