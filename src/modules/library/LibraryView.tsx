import { useCallback, useEffect, useState } from 'react'
import { importApi, libraryApi, subscribe } from '@/lib/ipc'
import type { BookListItem, ImportProgress } from '@/lib/types'
import { useSessionStore } from '@/stores/session'
import './library.css'

export function LibraryView() {
  const [books, setBooks] = useState<BookListItem[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const openBook = useSessionStore((s) => s.openBook)

  const refresh = useCallback(async () => {
    setBooks(await libraryApi.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onImport = useCallback(async () => {
    setBusy(true)
    setProgress('选择文件…')
    const off = subscribe('import:progress', (e) => {
      const p = e as ImportProgress
      setProgress(p.message ?? p.stage)
    })
    try {
      const res = await importApi.pickAndImport()
      if (res) {
        await refresh()
        setProgress(`已导入：${res.chapterCount} 章 / ${res.paragraphCount} 段`)
      } else {
        setProgress('')
      }
    } catch (err) {
      const msg = (err as Error).message ?? ''
      setProgress(
        msg.includes('未配置') || msg.includes('Key')
          ? '需要先配置 AI：请到「设置 → API 密钥」添加 DeepSeek Key'
          : `导入失败：${msg}`,
      )
    } finally {
      off()
      setBusy(false)
    }
  }, [refresh])

  const onDelete = useCallback(
    async (id: string) => {
      await libraryApi.delete(id)
      await refresh()
    },
    [refresh],
  )

  const onReparse = useCallback(
    async (id: string) => {
      setBusy(true)
      setProgress('AI 重新解析中…')
      const off = subscribe('import:progress', (e) => {
        const p = e as ImportProgress
        setProgress(p.message ?? p.stage)
      })
      try {
        const res = await importApi.reparse(id)
        await refresh()
        setProgress(`重新解析完成：${res.chapterCount} 章 / ${res.paragraphCount} 段`)
      } catch (err) {
        setProgress(`重新解析失败：${(err as Error).message}`)
      } finally {
        off()
        setBusy(false)
      }
    },
    [refresh],
  )

  return (
    <div className="lib">
      {books.length === 0 ? (
        /* —— 空态：居中引导，大气端庄 —— */
        <div className="lib__emptyState">
          <div className="lib__emptyIcon" aria-hidden>
            卷
          </div>
          <p className="lib__emptyDesc">导入你的第一本中医典籍，AI 解析章节内容</p>
          <button className="lib__sealBtn" disabled={busy} onClick={onImport}>
            {busy ? '导入中…' : '导入 EPUB'}
          </button>
          {progress && <p className="lib__progress">{progress}</p>}
        </div>
      ) : (
        /* —— 列表态：书库标题 + 卡片网格，导入作为网格末尾项 —— */
        <>
          <h2 className="lib__heading">书库</h2>
          {progress && <p className="lib__progress">{progress}</p>}
          <div className="lib__grid">
            {books.map((b) => (
              <div key={b.id} className="bookcard" onClick={() => openBook(b.id)}>
                <div className="bookcard__cover">{b.title.slice(0, 1)}</div>
                <div className="bookcard__body">
                  <div className="bookcard__title">{b.title}</div>
                  <div className="bookcard__meta">
                    {b.author || '佚名'} · {b.chapter_count} 章 · {b.paragraph_count} 段
                  </div>
                </div>
                <button
                  className="bookcard__rep"
                  title="AI 重新解析"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onReparse(b.id)
                  }}
                >
                  ↻
                </button>
                <button
                  className="bookcard__del"
                  title="删除"
                  aria-label="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    void onDelete(b.id)
                  }}
                >
                  ×
                </button>
              </div>
            ))}

            {/* 导入卡片：作为网格末尾项，占一格 */}
            <button
              className="lib__addCard"
              disabled={busy}
              onClick={onImport}
              title={busy ? '导入中…' : '导入 EPUB'}
            >
              <span className="lib__addIcon" aria-hidden>
                {busy ? '…' : '+'}
              </span>
              <span className="lib__addLabel">{busy ? '导入中' : '导入 EPUB'}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
