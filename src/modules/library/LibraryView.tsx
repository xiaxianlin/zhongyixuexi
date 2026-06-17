import { useCallback, useEffect, useState } from 'react'
import { libraryApi } from '@/lib/ipc'
import { aiApi, aiSubCodeFrom } from '@/lib/ai-api'
import { notesApi } from '@/lib/notes-api'
import { readingApi } from '@/lib/reading-api'
import { useSessionStore } from '@/stores/session'
import type { BookListItem, ChapterNode } from '@/lib/types'
import type { ParagraphNoteCard } from '@/modules/notes/types'
import type { ParagraphDTO } from '@/modules/reading/types'
import './library.css'

export function LibraryView() {
  const activeBookId = useSessionStore((s) => s.activeBookId)
  const activeChapterId = useSessionStore((s) => s.activeChapterId)
  const activeParagraphId = useSessionStore((s) => s.activeParagraphId)
  const clearBookTarget = useSessionStore((s) => s.clearBookTarget)
  const [books, setBooks] = useState<BookListItem[]>([])
  const [localDetailBookId, setLocalDetailBookId] = useState<string | null>(null)
  const detailBookId = activeBookId ?? localDetailBookId
  const selectedBook = books.find((b) => b.id === detailBookId) ?? null

  const refresh = useCallback(async () => {
    setBooks(await libraryApi.list())
  }, [])

  useEffect(() => {
    document.body.classList.toggle('is-library-detail', selectedBook !== null)
    return () => {
      document.body.classList.remove('is-library-detail')
    }
  }, [selectedBook])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="lib">
      {books.length === 0 ? (
        <div className="lib__emptyState">
          <div className="lib__emptyIcon" aria-hidden>
            卷
          </div>
          <p className="lib__emptyDesc">内置《黄帝八十一难经》正在初始化</p>
        </div>
      ) : selectedBook ? (
        <BookDetail
          book={selectedBook}
          targetChapterId={selectedBook.id === activeBookId ? activeChapterId : null}
          targetParagraphId={selectedBook.id === activeBookId ? activeParagraphId : null}
          onBack={() => {
            clearBookTarget()
            setLocalDetailBookId(null)
          }}
        />
      ) : (
        <div className="lib__grid">
          {books.map((b) => (
            <div
              key={b.id}
              className="bookcard"
              onClick={() => {
                clearBookTarget()
                setLocalDetailBookId(b.id)
              }}
            >
              <div className="bookcard__cover">{b.title.slice(0, 1)}</div>
              <div className="bookcard__body">
                <div className="bookcard__title">{b.title}</div>
                <div className="bookcard__meta">
                  {b.author || '佚名'} · {b.chapter_count} 章 · {b.paragraph_count} 段
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface BookDetailProps {
  book: BookListItem
  targetChapterId: string | null
  targetParagraphId: string | null
  onBack: () => void
}

function BookDetail({
  book,
  targetChapterId,
  targetParagraphId,
  onBack,
}: BookDetailProps) {
  const [tree, setTree] = useState<ChapterNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null)
  const [paragraphs, setParagraphs] = useState<ParagraphDTO[]>([])
  const [contentLoading, setContentLoading] = useState(false)
  const [notes, setNotes] = useState<ParagraphNoteCard[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [noteDraftContent, setNoteDraftContent] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [noteDrawerOpen, setNoteDrawerOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ParagraphNoteCard | null>(null)
  const [deletingNote, setDeletingNote] = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [reanalyzeConfirmOpen, setReanalyzeConfirmOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  useEffect(() => {
    let alive = true
    setTreeLoading(true)
    setTree([])
    setSelectedChapterId(null)
    setSelectedParagraphId(null)
    setParagraphs([])
    setNotes([])
    setNoteDrawerOpen(false)
    setToastMessage('')
    libraryApi
      .tree(book.id)
      .then((nextTree) => {
        if (!alive) return
        setTree(nextTree)
        const targetChapter = targetChapterId
          ? flattenChapters(nextTree).find((chapter) => chapter.id === targetChapterId)
          : null
        const firstChapter = targetChapter ?? nextTree[0] ?? null
        setSelectedChapterId(firstChapter?.id ?? null)
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
  }, [book.id, targetChapterId])

  const selectedParagraph =
    paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? null
  const selectedInterpretation = selectedParagraph?.interpretation ?? null
  const noteColumns = splitIntoColumns(notes, 3)

  useEffect(() => {
    let alive = true
    if (!selectedChapterId) {
      setParagraphs([])
      return () => {
        alive = false
      }
    }
    setContentLoading(true)
    setSelectedParagraphId(null)
    setNotes([])
    setNoteDrawerOpen(false)
    setToastMessage('')
    readingApi
      .getChapter(book.id, selectedChapterId)
      .then((content) => {
        if (!alive) return
        const nextParagraphs = content?.paragraphs ?? []
        setParagraphs(nextParagraphs)
        const targetParagraph = targetParagraphId
          ? nextParagraphs.find((paragraph) => paragraph.id === targetParagraphId)
          : null
        setSelectedParagraphId(targetParagraph?.id ?? nextParagraphs[0]?.id ?? null)
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
  }, [book.id, selectedChapterId, targetParagraphId])

  useEffect(() => {
    let alive = true
    if (!selectedParagraphId) {
      setNotes([])
      setNoteDrawerOpen(false)
      return () => {
        alive = false
      }
    }
    setNotesLoading(true)
    notesApi
      .getByParagraph(selectedParagraphId)
      .then((nextNotes) => {
        if (alive) setNotes(nextNotes)
      })
      .catch((e) => {
        if (alive) setToastMessage(`笔记加载失败：${(e as Error).message}`)
      })
      .finally(() => {
        if (alive) setNotesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [selectedParagraphId])

  useEffect(() => {
    if (!toastMessage) return undefined
    const timer = window.setTimeout(() => setToastMessage(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toastMessage])

  const selectChapter = useCallback((chapter: ChapterNode) => {
    setSelectedChapterId(chapter.id)
  }, [])

  const selectedParagraphAnalyzed = Boolean(selectedInterpretation?.meta)

  const runAnalysis = useCallback(async (force = false) => {
    if (!selectedParagraphId) return
    const startedAt = Date.now()
    setAiGenerating(true)
    setToastMessage('')
    try {
      const result = await aiApi.generateModern(selectedParagraphId, { force })
      const interpretation = {
        modern: compactAnalysisText(result.interpretation.modern ?? ''),
        explanation: compactAnalysisText(result.interpretation.explanation ?? ''),
        analysis: compactAnalysisText(result.interpretation.analysis ?? ''),
        meta: result.interpretation.meta,
      }
      setParagraphs((current) =>
        current.map((paragraph) =>
          paragraph.id === selectedParagraphId
            ? {
                ...paragraph,
                interpretation,
              }
            : paragraph,
        ),
      )
    } catch (e) {
      const subCode = aiSubCodeFrom(e)
      setToastMessage(
        subCode === 'AI_KEY_NOT_CONFIGURED'
          ? '请先在设置中配置 AI API Key'
          : `AI 解读失败：${(e as Error).message}`,
      )
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < 450) {
        await new Promise((resolve) => window.setTimeout(resolve, 450 - elapsed))
      }
      setAiGenerating(false)
    }
  }, [selectedParagraphId])

  const requestAnalysis = useCallback(() => {
    if (!selectedParagraphId) return
    if (selectedParagraphAnalyzed) {
      setReanalyzeConfirmOpen(true)
      return
    }
    void runAnalysis(true)
  }, [runAnalysis, selectedParagraphAnalyzed, selectedParagraphId])

  const createParagraphNote = useCallback(async () => {
    if (!selectedParagraphId || !selectedChapterId) return
    const content = noteDraftContent.trim()
    if (!content) {
      setToastMessage('先写一点笔记内容')
      return
    }
    setNoteSaving(true)
    setToastMessage('')
    try {
      await notesApi.create({
        book_id: book.id,
        chapter_id: selectedChapterId,
        paragraph_id: selectedParagraphId,
        content,
      })
      setNoteDraftContent('')
      setNoteModalOpen(false)
      setNoteDrawerOpen(true)
      setNotes(await notesApi.getByParagraph(selectedParagraphId))
    } catch (e) {
      setToastMessage(`笔记保存失败：${(e as Error).message}`)
    } finally {
      setNoteSaving(false)
    }
  }, [
    book.id,
    noteDraftContent,
    selectedChapterId,
    selectedParagraphId,
  ])

  const deleteNote = useCallback(async () => {
    if (!deleteTarget || !selectedParagraphId) return
    setDeletingNote(true)
    setToastMessage('')
    try {
      await notesApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      setNotes(await notesApi.getByParagraph(selectedParagraphId))
    } catch (e) {
      setToastMessage(`删除失败：${(e as Error).message}`)
    } finally {
      setDeletingNote(false)
    }
  }, [deleteTarget, selectedParagraphId])

  return (
    <div className="bookdetail">
      <header className="bookdetail__header">
        <button type="button" className="bookdetail__back" onClick={onBack} title="返回书库">
          ‹
        </button>
        <div className="bookdetail__titleBlock">
          <h2 className="bookdetail__title">{book.title}</h2>
        </div>
        <div className="bookdetail__headerActions">
          <button
            type="button"
            className="bookdetail__noteCount"
            disabled={!selectedParagraph}
            onClick={() => setNoteDrawerOpen(true)}
          >
            {notesLoading ? '笔记加载中' : `${notes.length} 篇笔记`}
          </button>
          <button
            type="button"
            className="bookdetail__primary"
            disabled={!selectedParagraph}
            onClick={() => setNoteModalOpen(true)}
          >
            添加笔记
          </button>
        </div>
      </header>

      <div className="bookdetail__workspace">
        <aside className="bookdetail__toc" aria-label="章">
          <div className="bookdetail__railHead">章</div>
          {treeLoading ? (
            <p className="bookdetail__empty">加载目录…</p>
          ) : tree.length === 0 ? (
            <p className="bookdetail__empty">无章节</p>
          ) : (
            <div className="bookdetail__list">
              {tree.map((chapter) => (
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
                  <span className="bookdetail__name">{chapter.title}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="bookdetail__paragraphs">
          <div className="bookdetail__paraHead">
            <div>
              <div className="bookdetail__railHead">段</div>
            </div>
          </div>

          {contentLoading ? (
            <p className="bookdetail__empty">加载段落…</p>
          ) : paragraphs.length === 0 ? (
            <p className="bookdetail__empty">本章暂无段落</p>
          ) : (
            <div className="bookdetail__paragraphList">
              {paragraphs.map((paragraph) => (
                <button
                  key={paragraph.id}
                  type="button"
                  className={
                    paragraph.id === selectedParagraphId
                      ? 'bookdetail__paragraph is-active'
                      : 'bookdetail__paragraph'
                  }
                  onClick={() => setSelectedParagraphId(paragraph.id)}
                >
                  <span className="bookdetail__paraText">{paragraph.text}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="bookdetail__inspector" aria-label="段落操作">
          {selectedParagraph ? (
            <>
              <div className="bookdetail__inspectHead">
                <div>
                  <div className="bookdetail__railTitleRow">
                    <div className="bookdetail__railHead">析</div>
                    {selectedParagraphAnalyzed && (
                      <span className="bookdetail__parsedTag">已解析</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={aiGenerating ? 'bookdetail__btn bookdetail__btn--loading' : 'bookdetail__btn'}
                  disabled={aiGenerating}
                  onClick={requestAnalysis}
                >
                  {aiGenerating && <span className="bookdetail__loadingSeal" aria-hidden />}
                  {aiGenerating ? '分析中' : '分析'}
                </button>
              </div>

              <div
                className="bookdetail__inspectScroll"
              >
                {aiGenerating && (
                  <div className="bookdetail__analysisOverlay" aria-live="polite">
                    <span className="bookdetail__analysisSpinner" aria-hidden />
                    <span>分析中</span>
                  </div>
                )}
                <section className="bookdetail__panelBlock">
                  <div className="bookdetail__panelTitle">白话</div>
                  {selectedInterpretation?.modern ? (
                    <p className="bookdetail__modernText">
                      {compactAnalysisText(selectedInterpretation.modern)}
                    </p>
                  ) : (
                    <p className="bookdetail__muted">尚未生成</p>
                  )}
                </section>

                <section className="bookdetail__panelBlock">
                  <div className="bookdetail__panelTitle">医理</div>
                  {selectedInterpretation?.explanation ? (
                    <pre className="bookdetail__explainText">
                      {formatMedicalExplanation(compactAnalysisText(selectedInterpretation.explanation))}
                    </pre>
                  ) : (
                    <p className="bookdetail__muted">暂无点拨</p>
                  )}
                </section>

                <section className="bookdetail__panelBlock">
                  <div className="bookdetail__panelTitle">解读</div>
                  {selectedInterpretation?.analysis ? (
                    <p className="bookdetail__analysisText">
                      {compactAnalysisText(selectedInterpretation.analysis)}
                    </p>
                  ) : (
                    <p className="bookdetail__muted">暂无解读</p>
                  )}
                </section>

              </div>
            </>
          ) : (
            <p className="bookdetail__empty">先选一段</p>
          )}
        </aside>
      </div>

      {noteDrawerOpen && (
        <div className="bookdetail__drawerLayer">
          <button
            type="button"
            className="bookdetail__drawerScrim"
            aria-label="关闭笔记列表"
            onClick={() => setNoteDrawerOpen(false)}
          />
          <aside className="bookdetail__noteDrawer" aria-label="笔记列表">
            <div className="bookdetail__noteDrawerHead">
              <div>
                <div className="bookdetail__drawerEyebrow">笔记</div>
                <h3>{notes.length} 篇笔记</h3>
              </div>
              <button type="button" onClick={() => setNoteDrawerOpen(false)}>
                ×
              </button>
            </div>
            {notesLoading ? (
              <p className="bookdetail__muted">加载中…</p>
            ) : notes.length === 0 ? (
              <p className="bookdetail__muted">还没有笔记</p>
            ) : (
              <div className="bookdetail__noteGrid">
                {noteColumns.map((column, columnIndex) => (
                  <div key={columnIndex} className="bookdetail__noteColumn">
                    {column.map((note) => (
                      <article
                        key={note.id}
                        className="bookdetail__noteItem"
                      >
                        <div className="bookdetail__noteItemHead">
                          <button
                            type="button"
                            className="bookdetail__noteDelete"
                            title="删除笔记"
                            onClick={(event) => {
                              event.stopPropagation()
                              setDeleteTarget(note)
                            }}
                          >
                            ×
                          </button>
                        </div>
                        <p>{note.content || '（空）'}</p>
                      </article>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {noteModalOpen && selectedParagraph && (
        <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
          <div className="bookdetail__modal">
            <div className="bookdetail__modalHead">
              <h3>添加笔记</h3>
              <button type="button" onClick={() => setNoteModalOpen(false)}>
                ×
              </button>
            </div>
            <textarea
              className="bookdetail__noteDraft"
              value={noteDraftContent}
              onChange={(event) => setNoteDraftContent(event.target.value)}
              placeholder="记下这一段的疑问、心得或临证联想"
              rows={8}
            />
            <div className="bookdetail__modalActions">
              <button type="button" className="bookdetail__btn" onClick={() => setNoteModalOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="bookdetail__primary"
                disabled={noteSaving}
                onClick={() => void createParagraphNote()}
              >
                {noteSaving ? '保存中' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
          <div className="bookdetail__modal bookdetail__modal--confirm">
            <div className="bookdetail__modalHead">
              <h3>确认删除</h3>
              <button type="button" onClick={() => setDeleteTarget(null)}>
                ×
              </button>
            </div>
            <p className="bookdetail__confirmText">删除这篇笔记？此操作不可撤销。</p>
            <div className="bookdetail__modalActions">
              <button type="button" className="bookdetail__btn" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button
                type="button"
                className="bookdetail__dangerBtn"
                disabled={deletingNote}
                onClick={() => void deleteNote()}
              >
                {deletingNote ? '删除中' : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reanalyzeConfirmOpen && (
        <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
          <div className="bookdetail__modal bookdetail__modal--confirm">
            <div className="bookdetail__modalHead">
              <h3>重新分析</h3>
              <button type="button" onClick={() => setReanalyzeConfirmOpen(false)}>
                ×
              </button>
            </div>
            <p className="bookdetail__confirmText">当前段落已有分析内容。重新分析会覆盖白话、医理和解读。</p>
            <div className="bookdetail__modalActions">
              <button
                type="button"
                className="bookdetail__btn"
                onClick={() => setReanalyzeConfirmOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="bookdetail__dangerBtn"
                disabled={aiGenerating}
                onClick={() => {
                  setReanalyzeConfirmOpen(false)
                  window.requestAnimationFrame(() => {
                    void runAnalysis(true)
                  })
                }}
              >
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className="bookdetail__toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  )
}

function formatMedicalExplanation(explanation: string): string {
  return explanation
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      if (lines.length >= 2 && /^\d+[.、]\s*/.test(lines[0])) {
        const prefix = lines[0].match(/^(\d+[.、])/)?.[1] ?? ''
        return `${prefix} ${lines.slice(1).join('\n')}`.trim()
      }
      return lines.join('\n')
    })
    .join('\n')
}

function compactAnalysisText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function splitIntoColumns<T>(items: T[], columnCount: number): T[][] {
  return items.reduce<T[][]>(
    (columns, item, index) => {
      columns[index % columnCount].push(item)
      return columns
    },
    Array.from({ length: columnCount }, () => []),
  )
}

function flattenChapters(chapters: ChapterNode[]): ChapterNode[] {
  return chapters.flatMap((chapter) => [chapter, ...flattenChapters(chapter.children)])
}
