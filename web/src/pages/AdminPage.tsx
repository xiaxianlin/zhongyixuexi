import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../lib/api'

export default function AdminPage() {
  return (
    <div>
      <h1>管理后台</h1>
      <BooksSection />
      <InviteCodesSection />
      <WalletSection />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Books / chapters / paragraphs (CMS-01/CMS-02)
// ---------------------------------------------------------------------------

interface AdminBook {
  id: string
  title: string
  author: string | null
  status: 'draft' | 'published'
}

function BooksSection() {
  const [books, setBooks] = useState<AdminBook[]>([])
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)

  function reload(): void {
    apiFetch<{ books: AdminBook[] }>('/admin/books')
      .then((res) => setBooks(res.books))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }

  useEffect(reload, [])

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch('/admin/books', { method: 'POST', body: JSON.stringify({ title, author }) })
      setTitle('')
      setAuthor('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function togglePublish(book: AdminBook): Promise<void> {
    const action = book.status === 'published' ? 'unpublish' : 'publish'
    await apiFetch(`/admin/books/${book.id}/${action}`, { method: 'POST' })
    reload()
  }

  async function deleteBook(bookId: string): Promise<void> {
    await apiFetch(`/admin/books/${bookId}`, { method: 'DELETE' })
    if (selectedBookId === bookId) setSelectedBookId(null)
    reload()
  }

  return (
    <section>
      <h2>书籍管理</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>书名</th>
            <th>作者</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {books.map((book) => (
            <tr key={book.id}>
              <td>{book.title}</td>
              <td>{book.author ?? '—'}</td>
              <td>{book.status === 'published' ? '已发布' : '草稿'}</td>
              <td>
                <button onClick={() => setSelectedBookId(book.id)}>管理内容</button>{' '}
                <button onClick={() => togglePublish(book)}>
                  {book.status === 'published' ? '下线' : '发布'}
                </button>{' '}
                <button onClick={() => deleteBook(book.id)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>新建书籍</h3>
      <form onSubmit={handleCreate}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="书名" />
        <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="作者（可选）" />
        <button type="submit">创建</button>
      </form>

      {selectedBookId && <BookContentEditor bookId={selectedBookId} />}
    </section>
  )
}

interface ChapterNode {
  id: string
  title: string
  orderIndex: number
  children: ChapterNode[]
}

interface Paragraph {
  id: string
  orderIndex: number
  text: string
}

interface AdminBookDetail {
  book: AdminBook
  chapters: ChapterNode[]
  paragraphsByChapter: Record<string, Paragraph[]>
}

function BookContentEditor({ bookId }: { bookId: string }) {
  const [detail, setDetail] = useState<AdminBookDetail | null>(null)
  const [chapterTitle, setChapterTitle] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reload(): void {
    apiFetch<AdminBookDetail>(`/admin/books/${bookId}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }

  useEffect(reload, [bookId])

  async function handleCreateChapter(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch(`/admin/books/${bookId}/chapters`, {
        method: 'POST',
        body: JSON.stringify({ title: chapterTitle }),
      })
      setChapterTitle('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建章节失败')
    }
  }

  async function deleteChapter(chapterId: string): Promise<void> {
    await apiFetch(`/admin/chapters/${chapterId}`, { method: 'DELETE' })
    reload()
  }

  if (error) return <p className="error">{error}</p>
  if (!detail) return <p>加载中…</p>

  return (
    <div>
      <h3>《{detail.book.title}》内容管理</h3>
      {detail.chapters.map((chapter) => (
        <div key={chapter.id} className="chapter">
          <h4>
            {chapter.title} <button onClick={() => deleteChapter(chapter.id)}>删除章节</button>
          </h4>
          <ParagraphList chapterId={chapter.id} paragraphs={detail.paragraphsByChapter[chapter.id] ?? []} onChange={reload} />
        </div>
      ))}
      <form onSubmit={handleCreateChapter}>
        <input value={chapterTitle} onChange={(e) => setChapterTitle(e.target.value)} placeholder="新章节标题" />
        <button type="submit">添加章节</button>
      </form>
    </div>
  )
}

function ParagraphList({
  chapterId,
  paragraphs,
  onChange,
}: {
  chapterId: string
  paragraphs: Paragraph[]
  onChange: () => void
}) {
  const [text, setText] = useState('')

  async function handleAdd(e: FormEvent): Promise<void> {
    e.preventDefault()
    await apiFetch(`/admin/chapters/${chapterId}/paragraphs`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    setText('')
    onChange()
  }

  async function handleDelete(paragraphId: string): Promise<void> {
    await apiFetch(`/admin/paragraphs/${paragraphId}`, { method: 'DELETE' })
    onChange()
  }

  return (
    <div>
      {paragraphs.map((p) => (
        <p key={p.id} className="paragraph">
          {p.text} <button onClick={() => handleDelete(p.id)}>删除</button>
        </p>
      ))}
      <form onSubmit={handleAdd}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="新段落原文" rows={2} />
        <button type="submit">添加段落</button>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Invite codes (AUTH-04)
// ---------------------------------------------------------------------------

interface InviteCode {
  id: string
  code: string
  maxUses: number | null
  useCount: number
  revokedAt: string | null
}

function InviteCodesSection() {
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [code, setCode] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reload(): void {
    apiFetch<{ inviteCodes: InviteCode[] }>('/admin/invite-codes')
      .then((res) => setCodes(res.inviteCodes))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }

  useEffect(reload, [])

  async function handleCreate(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    try {
      await apiFetch('/admin/invite-codes', {
        method: 'POST',
        body: JSON.stringify({ code, maxUses: maxUses ? Number(maxUses) : null }),
      })
      setCode('')
      setMaxUses('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  async function handleRevoke(id: string): Promise<void> {
    await apiFetch(`/admin/invite-codes/${id}/revoke`, { method: 'POST' })
    reload()
  }

  return (
    <section>
      <h2>邀请码管理</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>邀请码</th>
            <th>已用/上限</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c.id}>
              <td>{c.code}</td>
              <td>
                {c.useCount}/{c.maxUses ?? '不限'}
              </td>
              <td>{c.revokedAt ? '已作废' : '有效'}</td>
              <td>
                {!c.revokedAt && <button onClick={() => handleRevoke(c.id)}>作废</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={handleCreate}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="邀请码（自定义字符串）" />
        <input
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          placeholder="使用次数上限（留空=不限）"
        />
        <button type="submit">生成邀请码</button>
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Wallet top-ups (WALLET-02) — manual, no payment gateway
// ---------------------------------------------------------------------------

interface AdminUser {
  id: string
  username: string
  role: 'member' | 'admin'
}

function WalletSection() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [userId, setUserId] = useState('')
  const [deltaTokens, setDeltaTokens] = useState('')
  const [amountCny, setAmountCny] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<{ users: AdminUser[] }>('/admin/users')
      .then((res) => setUsers(res.users))
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }, [])

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setResult(null)
    try {
      const res = await apiFetch<{ balance: number }>(`/admin/wallets/${userId}/adjustments`, {
        method: 'POST',
        body: JSON.stringify({
          deltaTokens: Number(deltaTokens),
          amountCny: amountCny ? Number(amountCny) : null,
          note,
        }),
      })
      setResult(`成功，最新余额：${res.balance}`)
      setDeltaTokens('')
      setAmountCny('')
      setNote('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '充值失败')
    }
  }

  return (
    <section>
      <h2>会员充值（人工记账，不接支付渠道）</h2>
      {error && <p className="error">{error}</p>}
      {result && <p className="hint">{result}</p>}
      <form onSubmit={handleSubmit}>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">选择会员</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}（{u.role}）
            </option>
          ))}
        </select>
        <input
          value={deltaTokens}
          onChange={(e) => setDeltaTokens(e.target.value)}
          placeholder="Token 变动（充值为正数，更正可为负数）"
        />
        <input
          value={amountCny}
          onChange={(e) => setAmountCny(e.target.value)}
          placeholder="对应金额（元，可选）"
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="备注（如：微信转账50元）" />
        <button type="submit" disabled={!userId || !deltaTokens}>
          提交
        </button>
      </form>
    </section>
  )
}
