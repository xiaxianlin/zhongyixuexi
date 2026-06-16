import { useCallback, useEffect, useState } from 'react'
import { importApi, libraryApi, subscribe } from '@/lib/ipc'
import { readingApi } from '@/lib/reading-api'
import type { BookListItem, ChapterNode, ImportProgress } from '@/lib/types'
import type { ParagraphDTO } from '@/modules/reading/types'
import { useSessionStore } from '@/stores/session'
import './library.css'

export function LibraryView() {
  const [books, setBooks] = useState<BookListItem[]>([])
  const [detailBookId, setDetailBookId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const openBook = useSessionStore((s) => s.openBook)
  const openChapter = useSessionStore((s) => s.openChapter)
  const selectedBook = books.find((b) => b.id === detailBookId) ?? null

  const refresh = useCallback(async () => {
    setBooks(await libraryApi.list())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onImport = useCallback(async () => {
    setBusy(true)
    setProgress('')
    const off = subscribe('import:progress', (e) => {
      const p = e as ImportProgress
      setProgress(p.message ?? p.stage)
    })
    try {
      const res = await importApi.pickAndImport()
      if (res) {
        await refresh()
        setProgress(
          `完成解析：${res.chapterCount} 章 / ${res.paragraphCount} 段 / ${res.taskCount ?? 0} 个任务`,
        )
      } else {
        setProgress('')
      }
    } catch (err) {
      const msg = (err as Error).message ?? ''
      setProgress(
        msg.includes('未配置') || msg.includes('Key')
          ? '全书解析需要 AI：请到「设置 → API 密钥」添加 DeepSeek Key'
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
      setDetailBookId((cur) => (cur === id ? null : cur))
      await refresh()
    },
    [refresh],
  )

  const onReparse = useCallback(
    async (id: string) => {
      setBusy(true)
      setProgress('全书 AI 重新解析中…')
      const off = subscribe('import:progress', (e) => {
        const p = e as ImportProgress
        setProgress(p.message ?? p.stage)
      })
      try {
        const res = await importApi.reparse(id)
        await refresh()
        setProgress(
          `重新解析完成：${res.chapterCount} 章 / ${res.paragraphCount} 段 / ${res.taskCount ?? 0} 个任务`,
        )
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
      ) : selectedBook ? (
        <BookDetail
          book={selectedBook}
          busy={busy}
          progress={progress}
          onBack={() => setDetailBookId(null)}
          onImport={onImport}
          onDelete={onDelete}
          onReparse={onReparse}
          onOpenBook={openBook}
          onOpenChapter={(chapterId, paragraphId) => {
            openBook(selectedBook.id)
            openChapter(chapterId, paragraphId)
          }}
        />
      ) : (
        /* —— 列表态：书库标题 + 卡片网格，导入作为网格末尾项 —— */
        <>
          <h2 className="lib__heading">书库</h2>
          {progress && <p className="lib__progress">{progress}</p>}
          <div className="lib__grid">
            {books.map((b) => (
              <div key={b.id} className="bookcard" onClick={() => setDetailBookId(b.id)}>
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

interface BookDetailProps {
  book: BookListItem
  busy: boolean
  progress: string
  onBack: () => void
  onImport: () => void
  onDelete: (id: string) => Promise<void>
  onReparse: (id: string) => Promise<void>
  onOpenBook: (bookId: string) => void
  onOpenChapter: (chapterId: string, paragraphId?: string | null) => void
}

function BookDetail({
  book,
  busy,
  progress,
  onBack,
  onImport,
  onDelete,
  onReparse,
  onOpenBook,
  onOpenChapter,
}: BookDetailProps) {
  const [tree, setTree] = useState<ChapterNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [paragraphs, setParagraphs] = useState<ParagraphDTO[]>([])
  const [contentLoading, setContentLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setTreeLoading(true)
    setTree([])
    setSelectedChapterId(null)
    setSelectedSectionId(null)
    setParagraphs([])
    libraryApi
      .tree(book.id)
      .then((nextTree) => {
        if (!alive) return
        setTree(nextTree)
        const firstChapter = nextTree[0] ?? null
        const firstSection = firstChapter ? firstReadableNode(firstChapter) : null
        setSelectedChapterId(firstChapter?.id ?? null)
        setSelectedSectionId(firstSection?.id ?? null)
      })
      .catch(() => {
        if (alive) setTree([])
      })
      .finally(() => {
        if (alive) setTreeLoading(false)
      })
    return () => {
      alive = false
    }
  }, [book.id])

  const selectedChapter = tree.find((chapter) => chapter.id === selectedChapterId) ?? null
  const sections = selectedChapter ? sectionNodes(selectedChapter) : []
  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? null

  useEffect(() => {
    if (!selectedChapter || selectedSectionId !== null) return
    setSelectedSectionId(firstReadableNode(selectedChapter)?.id ?? null)
  }, [selectedChapter, selectedSectionId])

  useEffect(() => {
    let alive = true
    if (!selectedSectionId) {
      setParagraphs([])
      return () => {
        alive = false
      }
    }
    setContentLoading(true)
    readingApi
      .getChapter(book.id, selectedSectionId)
      .then((content) => {
        if (alive) setParagraphs(content?.paragraphs ?? [])
      })
      .catch(() => {
        if (alive) setParagraphs([])
      })
      .finally(() => {
        if (alive) setContentLoading(false)
      })
    return () => {
      alive = false
    }
  }, [book.id, selectedSectionId])

  const selectChapter = useCallback((chapter: ChapterNode) => {
    const nextSection = firstReadableNode(chapter)
    setSelectedChapterId(chapter.id)
    setSelectedSectionId(nextSection?.id ?? null)
  }, [])

  return (
    <div className="bookdetail">
      <header className="bookdetail__header">
        <button type="button" className="bookdetail__back" onClick={onBack} title="返回书库">
          ‹
        </button>
        <div className="bookdetail__cover" aria-hidden>
          {book.title.slice(0, 1)}
        </div>
        <div className="bookdetail__titleBlock">
          <h2 className="bookdetail__title">{book.title}</h2>
          <div className="bookdetail__meta">
            {book.author || '佚名'} · {book.chapter_count} 章 · {book.paragraph_count} 段
          </div>
        </div>
        <div className="bookdetail__actions">
          <button type="button" className="bookdetail__btn" disabled={busy} onClick={onImport}>
            导入
          </button>
          <button
            type="button"
            className="bookdetail__btn"
            disabled={busy}
            onClick={() => void onReparse(book.id)}
          >
            重析
          </button>
          <button type="button" className="bookdetail__primary" onClick={() => onOpenBook(book.id)}>
            阅读
          </button>
          <button
            type="button"
            className="bookdetail__danger"
            title="删除"
            aria-label="删除"
            onClick={() => void onDelete(book.id)}
          >
            ×
          </button>
        </div>
      </header>

      {progress && <p className="lib__progress">{progress}</p>}

      <div className="bookdetail__workspace">
        <aside className="bookdetail__toc" aria-label="章">
          <div className="bookdetail__railHead">章</div>
          {treeLoading ? (
            <p className="bookdetail__empty">加载目录…</p>
          ) : tree.length === 0 ? (
            <p className="bookdetail__empty">无章节</p>
          ) : (
            <div className="bookdetail__list">
              {tree.map((chapter, index) => (
                <button
                  key={chapter.id}
                  type="button"
                  className={
                    chapter.id === selectedChapterId
                      ? 'bookdetail__chapter is-active'
                      : 'bookdetail__chapter'
                  }
                  onClick={() => selectChapter(chapter)}
                >
                  <span className="bookdetail__ord">{index + 1}</span>
                  <span className="bookdetail__name">{chapter.title}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <aside className="bookdetail__toc" aria-label="节">
          <div className="bookdetail__railHead">节</div>
          {selectedChapter ? (
            <div className="bookdetail__list">
              {sections.map((section, index) => (
                <button
                  key={section.id}
                  type="button"
                  className={
                    section.id === selectedSectionId
                      ? 'bookdetail__section is-active'
                      : 'bookdetail__section'
                  }
                  onClick={() => setSelectedSectionId(section.id)}
                >
                  <span className="bookdetail__ord">{index + 1}</span>
                  <span className="bookdetail__name">{section.title}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="bookdetail__empty">先选一章</p>
          )}
        </aside>

        <section className="bookdetail__paragraphs">
          <div className="bookdetail__paraHead">
            <div>
              <div className="bookdetail__railHead">段</div>
              <h3 className="bookdetail__sectionTitle">{selectedSection?.title ?? '未选择'}</h3>
            </div>
            <button
              type="button"
              className="bookdetail__btn"
              disabled={!selectedSectionId}
              onClick={() => {
                if (selectedSectionId) onOpenChapter(selectedSectionId, null)
              }}
            >
              打开本节
            </button>
          </div>

          {contentLoading ? (
            <p className="bookdetail__empty">加载段落…</p>
          ) : paragraphs.length === 0 ? (
            <p className="bookdetail__empty">本节暂无段落</p>
          ) : (
            <div className="bookdetail__paragraphGrid">
              {paragraphs.map((paragraph, index) => (
                <button
                  key={paragraph.id}
                  type="button"
                  className="bookdetail__paragraph"
                  onClick={() => onOpenChapter(paragraph.chapter_id, paragraph.id)}
                >
                  <span className="bookdetail__paraNo">{index + 1}</span>
                  <span className="bookdetail__paraText">{paragraph.text}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function firstReadableNode(node: ChapterNode): ChapterNode {
  return node.children[0] ? firstReadableNode(node.children[0]) : node
}

function sectionNodes(chapter: ChapterNode): ChapterNode[] {
  return chapter.children.length > 0 ? flattenReadableNodes(chapter.children) : [chapter]
}

function flattenReadableNodes(nodes: ChapterNode[]): ChapterNode[] {
  return nodes.flatMap((node) =>
    node.children.length > 0 ? flattenReadableNodes(node.children) : [node],
  )
}
