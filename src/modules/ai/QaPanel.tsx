/**
 * QaPanel — AI-02 RAG question-answering side panel.
 *
 * Always-mounted side panel (the user opens/closes it). Holds the input box,
 * the conversation (answer + [n] source citations), loading state, and the
 * degraded-state placeholder. Source citations are clickable: onCite fires
 * with the paragraphId so the parent (App/reading view) can jump to that
 * paragraph and highlight the snippet.
 *
 * All AI calls go through useAiStore.run() so a failure flips the store into
 * the degraded state and surfaces the DegradedNotice banner — the panel itself
 * just shows a gentle inline message.
 *
 * Mount point: a slide-in right sidebar in the app shell. Suggested by main
 * agent in App.tsx:
 *   <QaPanel open={qaOpen} onCite={(pid) => session.openChapter(..., pid)} />
 */
import React, { useState, useCallback } from 'react'
import { aiApi } from '@/lib/ai-api'
import { useAiStore } from '@/stores/ai'
import { useSessionStore } from '@/stores/session'
import type { QaAnswerDTO } from './types'

export interface QaPanelProps {
  open: boolean
  onClose?: () => void
  /** Optional book scope (set when the panel is opened from a book context). */
  bookId?: string | null
  /** Called when the user clicks a [n] citation; parent jumps to the paragraph. */
  onCite?: (paragraphId: string, snippet: string) => void
}

export function QaPanel({ open, onClose, bookId, onCite }: QaPanelProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [answer, setAnswer] = useState<QaAnswerDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = useAiStore((s) => s.run)
  const degraded = useAiStore((s) => s.degraded)
  const sessionBookId = useSessionStore((s) => s.activeBookId)
  const scope = bookId ?? sessionBookId

  const handleAsk = useCallback(async () => {
    const q = query.trim()
    if (!q || loading) return
    setLoading(true)
    setError(null)
    const res = await run(() => aiApi.ask(q, { bookId: scope }))
    setLoading(false)
    if (res === null) {
      // run() already entered degraded state; show a gentle inline hint.
      setError('AI 调用失败，请查看顶部提示或稍后重试。')
      return
    }
    setAnswer(res)
  }, [query, loading, run, scope])

  const handleCite = useCallback(
    (paragraphId: string, snippet: string) => {
      if (!paragraphId) return
      onCite?.(paragraphId, snippet)
    },
    [onCite],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleAsk()
    }
  }

  return (
    <aside
      className={open ? 'ai-qa-panel is-open' : 'ai-qa-panel'}
      aria-label="AI 问答"
      aria-hidden={!open}
    >
      <header className="ai-qa-panel__header">
        <h3>智能问答</h3>
        {onClose && (
          <button type="button" className="ai-qa-panel__close" onClick={onClose} aria-label="关闭问答">
            ×
          </button>
        )}
      </header>

      <div className="ai-qa-panel__body">
        {answer ? (
          <AnswerView answer={answer} onCite={handleCite} />
        ) : (
          <div className="ai-qa-panel__empty">
            {degraded ? 'AI 暂不可用，请查看顶部提示。' : '基于已导入的书籍内容回答问题，答案标注来源可跳转。'}
          </div>
        )}
        {error && <div className="ai-qa-panel__error">{error}</div>}
      </div>

      <div className="ai-qa-panel__input">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="问一个问题，如「人参补什么」…（Cmd/Ctrl+Enter 发送）"
          rows={3}
          disabled={loading}
          maxLength={2000}
        />
        <button
          type="button"
          className="ai-qa-panel__send"
          onClick={handleAsk}
          disabled={loading || !query.trim()}
        >
          {loading ? '思考中…' : '发送'}
        </button>
      </div>
      <p className="ai-qa-panel__disclaimer">AI 辅助生成 · 本工具不提供诊疗建议</p>
    </aside>
  )
}

function AnswerView({
  answer,
  onCite,
}: {
  answer: QaAnswerDTO
  onCite: (paragraphId: string, snippet: string) => void
}): JSX.Element {
  return (
    <article className="ai-qa-answer">
      <p className="ai-qa-answer__text">{answer.answer}</p>
      {answer.scrubbed && (
        <p className="ai-qa-answer__scrubbed">部分内容已依合规要求隐藏。</p>
      )}
      {answer.cites.length > 0 && (
        <ol className="ai-qa-answer__cites">
          {answer.cites.map((c) => (
            <li key={c.n}>
              <button
                type="button"
                className="ai-qa-answer__cite"
                onClick={() => onCite(c.paragraphId, c.snippet)}
                title={c.snippet}
              >
                [{c.n}] {c.snippet.slice(0, 40)}
                {c.snippet.length > 40 ? '…' : ''}
              </button>
            </li>
          ))}
        </ol>
      )}
      <p className="ai-qa-answer__meta">
        {answer.fromCache ? '已缓存' : answer.model} · {answer.tokens} tokens
      </p>
    </article>
  )
}
