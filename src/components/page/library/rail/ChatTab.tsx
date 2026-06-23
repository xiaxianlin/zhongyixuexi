/**
 * ChatTab — chapter-scoped AI Q&A (v3.1 D5, 析 → 对话).
 *
 * Reads chatThread + chatMessages + chatStreaming from the library store and
 * drives sendChatMessage / resetChatThread. On mount it subscribes to streaming
 * token deltas (ai:chat:token) so the assistant bubble fills in live.
 *
 * The input area pre-fills a `> 引用` block when a pending quote was set by the
 * selection toolbar's 引用 button.
 */
import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '@/models/library/store'

export function ChatTab() {
  const messages = useLibraryStore((s) => s.chatMessages)
  const streaming = useLibraryStore((s) => s.chatStreaming)
  const sendMessage = useLibraryStore((s) => s.sendChatMessage)
  const resetThread = useLibraryStore((s) => s.resetChatThread)
  const pendingQuote = useLibraryStore((s) => s.pendingQuote)
  const setPendingQuote = useLibraryStore((s) => s.setPendingQuote)
  const subscribeTokens = useLibraryStore((s) => s.subscribeChatTokens)

  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // subscribe to token deltas while mounted
  useEffect(() => subscribeTokens(), [subscribeTokens])

  // when a quote is pending, render it as a pre-filled block above the input
  useEffect(() => {
    if (pendingQuote) setDraft((d) => d)
  }, [pendingQuote])

  // auto-scroll to bottom on new content
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    void sendMessage(text)
  }

  const clearQuote = () => setPendingQuote(null)

  return (
    <div className="chattab">
      <div className="chattab__scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <p className="railtab__empty">就本章内容提问，比如「这一段在讲什么？」「XX 术语怎么理解？」。</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'chattab__bubble chattab__bubble--user'
                  : 'chattab__bubble chattab__bubble--assistant'
              }
            >
              {m.quote_text ? <blockquote className="chattab__quote">{m.quote_text}</blockquote> : null}
              <p className="chattab__text">{m.content || (streaming ? '…' : '')}</p>
            </div>
          ))
        )}
      </div>

      <div className="chattab__composer">
        {pendingQuote && (
          <div className="chattab__pending">
            <blockquote className="chattab__pendingQuote">{pendingQuote}</blockquote>
            <button type="button" className="chattab__pendingClear" onClick={clearQuote} aria-label="移除引用">
              ✕
            </button>
          </div>
        )}
        <div className="chattab__inputRow">
          <textarea
            className="chattab__input"
            value={draft}
            placeholder={streaming ? '回答生成中…' : '就本章提问…'}
            disabled={streaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            rows={2}
          />
          <button
            type="button"
            className="chattab__send"
            disabled={streaming || draft.trim() === ''}
            onClick={send}
          >
            {streaming ? '…' : '发送'}
          </button>
        </div>
        <div className="chattab__foot">
          <span className="chattab__hint">Enter 发送 · Shift+Enter 换行</span>
          <button
            type="button"
            className="chattab__reset"
            disabled={streaming || messages.length === 0}
            onClick={() => void resetThread()}
          >
            清空对话
          </button>
        </div>
      </div>
    </div>
  )
}
