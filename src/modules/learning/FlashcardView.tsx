/**
 * Flashcard review view (LRN-04 — 04-learning.md §6.2).
 *
 * Implements the flip-card state machine:
 *   idle → showingFront → showingBack → graded → next (loop) / done
 *
 * Keyboard:
 *   Space       — flip front→back
 *   1 / A       — again (重来)
 *   2 / H       — hard (困难)
 *   3 / G       — good (良好)
 *   4 / E       — easy (简单)
 *   Ctrl+Z      — undo last review
 *   Esc         — exit to daily plan
 */

import { useCallback, useEffect } from 'react'
import { useLearningStore } from '@/stores/learning'
import type { GradeLabel, ReviewMode } from './types'
import './learning.css'

const GRADE_BUTTONS: { label: GradeLabel; key: string; text: string; className: string }[] = [
  { label: 'again', key: '1', text: '重来', className: 'flashcard__grade--again' },
  { label: 'hard', key: '2', text: '困难', className: 'flashcard__grade--hard' },
  { label: 'good', key: '3', text: '良好', className: 'flashcard__grade--good' },
  { label: 'easy', key: '4', text: '简单', className: 'flashcard__grade--easy' },
]

export function FlashcardView({ mode = 'today', onExit }: { mode?: ReviewMode; onExit?: () => void }) {
  const { queue, cursor, current, flipState, submitting, sessionStats, error, loadQueue, flip, grade, undo, reset } =
    useLearningStore()

  useEffect(() => {
    void loadQueue(mode)
  }, [loadQueue, mode])

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (flipState === 'done' || flipState === 'idle') return

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (flipState === 'showingFront') flip()
      } else if (flipState === 'showingBack' && !submitting) {
        const map: Record<string, GradeLabel> = {
          '1': 'again',
          a: 'again',
          A: 'again',
          '2': 'hard',
          h: 'hard',
          H: 'hard',
          '3': 'good',
          g: 'good',
          G: 'good',
          '4': 'easy',
          e: 'easy',
          E: 'easy',
        }
        const label = map[e.key]
        if (label) {
          e.preventDefault()
          void grade(label)
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        void undo()
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        reset()
        onExit?.()
      }
    },
    [flipState, submitting, flip, grade, undo, reset, onExit],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  if (flipState === 'idle') {
    return (
      <div className="flashcard flashcard--loading">
        <p>加载复习队列…</p>
        {error && <p className="flashcard__error">{error}</p>}
      </div>
    )
  }

  if (flipState === 'done') {
    return (
      <div className="flashcard flashcard--done">
        <h3>本次复习完成</h3>
        <div className="flashcard__summary">
          <p>复习 {sessionStats.reviewed} 张</p>
          <p>重来 {sessionStats.again} 张</p>
          <p>用时 {Math.round(sessionStats.totalMs / 1000)} 秒</p>
        </div>
        <div className="flashcard__actions">
          <button onClick={() => void loadQueue(mode)}>再来一轮</button>
          {onExit && <button onClick={onExit}>返回</button>}
        </div>
      </div>
    )
  }

  if (!current) return null

  const showBack = flipState === 'showingBack' || flipState === 'graded'
  const progress = `${cursor + 1} / ${queue.length}`

  return (
    <div className="flashcard">
      <div className="flashcard__header">
        <span className="flashcard__progress">{progress}</span>
        <span className="flashcard__type">{typeLabel(current.type)}</span>
        <button className="flashcard__exit" onClick={() => { reset(); onExit?.() }} title="退出 (Esc)">
          ✕
        </button>
      </div>

      <div
        className={`flashcard__card ${showBack ? 'flashcard__card--flipped' : ''}`}
        onClick={() => flipState === 'showingFront' && flip()}
      >
        <div className="flashcard__front">
          <p className="flashcard__label">正面</p>
          <div className="flashcard__text flashcard__text--front">{current.front}</div>
          {flipState === 'showingFront' && (
            <p className="flashcard__hint">点击或按空格键查看答案</p>
          )}
        </div>
        {showBack && (
          <div className="flashcard__back">
            <p className="flashcard__label">反面</p>
            <div className="flashcard__text flashcard__text--back">{current.back}</div>
          </div>
        )}
      </div>

      {error && <p className="flashcard__error">{error}</p>}

      {showBack && (
        <div className="flashcard__grades">
          {GRADE_BUTTONS.map((btn) => (
            <button
              key={btn.label}
              className={`flashcard__grade ${btn.className}`}
              disabled={submitting}
              onClick={() => void grade(btn.label)}
              title={`[${btn.key}] ${btn.text}`}
            >
              <span className="flashcard__grade-key">{btn.key}</span>
              <span className="flashcard__grade-text">{btn.text}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flashcard__footer">
        <button
          className="flashcard__undo"
          onClick={() => void undo()}
          disabled={sessionStats.reviewed === 0}
          title="撤销 (Ctrl+Z)"
        >
          撤销
        </button>
      </div>
    </div>
  )
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    original_to_interpret: '原文 → 解读',
    term_to_meaning: '术语 → 释义',
    image_to_name: '配图 → 名称',
    title_to_points: '标题 → 要点',
  }
  return labels[type] ?? type
}
