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
      setProgress(`导入失败：${(err as Error).message}`)
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

  return (
    <div className="lib">
      <div className="lib__toolbar">
        <h2>书库</h2>
        <button className="lib__import" disabled={busy} onClick={onImport}>
          {busy ? '导入中…' : '+ 导入 EPUB'}
        </button>
      </div>

      {progress && <p className="lib__progress">{progress}</p>}

      {books.length === 0 ? (
        <p className="lib__empty">还没有书籍，点击「导入 EPUB」开始。</p>
      ) : (
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
        </div>
      )}
    </div>
  )
}
