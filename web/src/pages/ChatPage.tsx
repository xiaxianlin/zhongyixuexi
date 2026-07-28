import { useState, type FormEvent } from 'react'
import { ApiError, apiFetch } from '../lib/api'

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  conversationId: string
  answer: string
  blocked: boolean
  balance: number
}

export default function ChatPage() {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [balance, setBalance] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsTopUp, setNeedsTopUp] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const q = question.trim()
    if (!q) return
    setError(null)
    setNeedsTopUp(false)
    setSubmitting(true)
    setTurns((prev) => [...prev, { role: 'user', content: q }])
    setQuestion('')
    try {
      const res = await apiFetch<ChatResponse>('/chat', {
        method: 'POST',
        body: JSON.stringify({ conversationId, question: q }),
      })
      setConversationId(res.conversationId)
      setBalance(res.balance)
      setTurns((prev) => [...prev, { role: 'assistant', content: res.answer }])
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsTopUp(true)
      } else {
        setError(err instanceof Error ? err.message : '发送失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1>AI 问答</h1>
      <p className="hint">仅充值会员可用，按 token 用量从钱包余额扣减。</p>
      {needsTopUp && (
        <p className="error">需要充值会员才能提问 —— 请联系管理员充值，或到"我的钱包"查看余额。</p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="chatPage">
        <div className="chatPage__main">
          <div className="chat-log">
            {turns.map((turn, i) => (
              <div key={i} className={`chat-message ${turn.role}`}>
                <strong>{turn.role === 'user' ? '我' : 'AI'}：</strong>
                {turn.content}
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="就经典内容提问…"
              rows={2}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? '发送中…' : '发送'}
            </button>
          </form>
        </div>

        <div className="chatPage__wallet">
          <div className="chatPage__walletLabel">钱包余额</div>
          <div className="chatPage__walletValue tabular">
            {balance !== null ? balance.toLocaleString() : '—'}
          </div>
          <p className="hint">token</p>
        </div>
      </div>
    </div>
  )
}
