import { useCallback, useEffect, useState } from 'react'
import { libraryApi } from '@/lib/ipc'
import { aiApi, aiSubCodeFrom } from '@/lib/ai-api'
import { notesApi } from '@/lib/notes-api'
import { readingApi } from '@/lib/reading-api'
import type { BookListItem, ChapterNode } from '@/lib/types'
import type { Note, NoteListItem } from '@/modules/notes/types'
import type { ParagraphDTO } from '@/modules/reading/types'
import './library.css'

export function LibraryView() {
  const [books, setBooks] = useState<BookListItem[]>([])
  const [detailBookId, setDetailBookId] = useState<string | null>(null)
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
          onBack={() => setDetailBookId(null)}
        />
      ) : (
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface BookDetailProps {
  book: BookListItem
  onBack: () => void
}

function BookDetail({
  book,
  onBack,
}: BookDetailProps) {
  const [tree, setTree] = useState<ChapterNode[]>([])
  const [treeLoading, setTreeLoading] = useState(true)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [selectedParagraphId, setSelectedParagraphId] = useState<string | null>(null)
  const [paragraphs, setParagraphs] = useState<ParagraphDTO[]>([])
  const [contentLoading, setContentLoading] = useState(false)
  const [notes, setNotes] = useState<NoteListItem[]>([])
  const [notesLoading, setNotesLoading] = useState(false)
  const [noteDraftTitle, setNoteDraftTitle] = useState('')
  const [noteDraftContent, setNoteDraftContent] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteModalOpen, setNoteModalOpen] = useState(false)
  const [noteDetail, setNoteDetail] = useState<Note | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NoteListItem | null>(null)
  const [deletingNote, setDeletingNote] = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)
  const [actionMessage, setActionMessage] = useState('')

  useEffect(() => {
    let alive = true
    setTreeLoading(true)
    setTree([])
    setSelectedChapterId(null)
    setSelectedParagraphId(null)
    setParagraphs([])
    setNotes([])
    setActionMessage('')
    libraryApi
      .tree(book.id)
      .then((nextTree) => {
        if (!alive) return
        setTree(nextTree)
        const firstChapter = nextTree[0] ?? null
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
  }, [book.id])

  const selectedChapter = tree.find((chapter) => chapter.id === selectedChapterId) ?? null
  const selectedParagraph =
    paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? null

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
    setActionMessage('')
    readingApi
      .getChapter(book.id, selectedChapterId)
      .then((content) => {
        if (!alive) return
        const nextParagraphs = content?.paragraphs ?? []
        setParagraphs(nextParagraphs)
        setSelectedParagraphId(nextParagraphs[0]?.id ?? null)
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
  }, [book.id, selectedChapterId])

  useEffect(() => {
    let alive = true
    if (!selectedParagraphId) {
      setNotes([])
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
        if (alive) setActionMessage(`笔记加载失败：${(e as Error).message}`)
      })
      .finally(() => {
        if (alive) setNotesLoading(false)
      })
    return () => {
      alive = false
    }
  }, [selectedParagraphId])

  const selectChapter = useCallback((chapter: ChapterNode) => {
    setSelectedChapterId(chapter.id)
  }, [])

  const generateModern = useCallback(async () => {
    if (!selectedParagraph) return
    setAiGenerating(true)
    setActionMessage('')
    try {
      const result = await aiApi.generateModern(selectedParagraph.id)
      const contentModern = result.sentences.map((sentence) => sentence.modern).join('\n')
      const contentExplanation = result.sentences
        .map((sentence, index) => `${index + 1}. ${sentence.commentary}`)
        .join('\n\n')
      setParagraphs((current) =>
        current.map((paragraph) =>
          paragraph.id === selectedParagraph.id
            ? {
                ...paragraph,
                content_modern: contentModern,
                content_explanation: contentExplanation,
              }
            : paragraph,
        ),
      )
      setActionMessage(result.fromCache ? '已读取缓存解读' : 'AI 解读已生成')
    } catch (e) {
      const subCode = aiSubCodeFrom(e)
      setActionMessage(
        subCode === 'AI_KEY_NOT_CONFIGURED'
          ? '请先在设置中配置 AI API Key'
          : `AI 解读失败：${(e as Error).message}`,
      )
    } finally {
      setAiGenerating(false)
    }
  }, [selectedParagraph])

  const createParagraphNote = useCallback(async () => {
    if (!selectedParagraph || !selectedChapter) return
    const content = noteDraftContent.trim()
    if (!content) {
      setActionMessage('先写一点笔记内容')
      return
    }
    setNoteSaving(true)
    setActionMessage('')
    try {
      await notesApi.create({
        book_id: book.id,
        chapter_id: selectedChapter.id,
        paragraph_id: selectedParagraph.id,
        title: noteDraftTitle.trim() || `${selectedChapter.title} · 段落笔记`,
        content,
      })
      setNoteDraftTitle('')
      setNoteDraftContent('')
      setNoteModalOpen(false)
      setNotes(await notesApi.getByParagraph(selectedParagraph.id))
      setActionMessage('笔记已保存')
    } catch (e) {
      setActionMessage(`笔记保存失败：${(e as Error).message}`)
    } finally {
      setNoteSaving(false)
    }
  }, [
    book.id,
    noteDraftContent,
    noteDraftTitle,
    selectedChapter,
    selectedParagraph,
  ])

  const openNoteDetail = useCallback(async (noteId: string) => {
    setActionMessage('')
    try {
      const nextNote = await notesApi.get(noteId)
      setNoteDetail(nextNote)
    } catch (e) {
      setActionMessage(`笔记详情加载失败：${(e as Error).message}`)
    }
  }, [])

  const deleteNote = useCallback(async () => {
    if (!deleteTarget || !selectedParagraph) return
    setDeletingNote(true)
    setActionMessage('')
    try {
      await notesApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      setNoteDetail((current) => (current?.id === deleteTarget.id ? null : current))
      setNotes(await notesApi.getByParagraph(selectedParagraph.id))
      setActionMessage('笔记已删除')
    } catch (e) {
      setActionMessage(`删除失败：${(e as Error).message}`)
    } finally {
      setDeletingNote(false)
    }
  }, [deleteTarget, selectedParagraph])

  return (
    <div className="bookdetail">
      <header className="bookdetail__header">
        <button type="button" className="bookdetail__back" onClick={onBack} title="返回书库">
          ‹
        </button>
        <div className="bookdetail__titleBlock">
          <h2 className="bookdetail__title">{book.title}</h2>
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
              <h3 className="bookdetail__sectionTitle">{selectedChapter?.title ?? '未选择'}</h3>
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
                  <div className="bookdetail__railHead">析</div>
                  <h3 className="bookdetail__sectionTitle">当前段</h3>
                </div>
                <button
                  type="button"
                  className="bookdetail__btn"
                  disabled={aiGenerating}
                  onClick={() => void generateModern()}
                >
                  {aiGenerating ? '生成中' : 'AI 解读'}
                </button>
              </div>

              {actionMessage && <p className="bookdetail__message">{actionMessage}</p>}

              <div className="bookdetail__inspectScroll">
                <section className="bookdetail__panelBlock">
                  <div className="bookdetail__panelTitle">白话</div>
                  {selectedParagraph.content_modern ? (
                    <p className="bookdetail__modernText">{selectedParagraph.content_modern}</p>
                  ) : (
                    <p className="bookdetail__muted">尚未生成</p>
                  )}
                </section>

                <section className="bookdetail__panelBlock">
                  <div className="bookdetail__panelTitle">医理</div>
                  {selectedParagraph.content_explanation ? (
                    <pre className="bookdetail__explainText">
                      {formatMedicalExplanation(selectedParagraph.content_explanation)}
                    </pre>
                  ) : (
                    <p className="bookdetail__muted">暂无点拨</p>
                  )}
                </section>

                <section className="bookdetail__panelBlock">
                  <div className="bookdetail__noteHead">
                    <div className="bookdetail__panelTitle">笔记</div>
                    <button
                      type="button"
                      className="bookdetail__miniBtn"
                      onClick={() => setNoteModalOpen(true)}
                    >
                      添加
                    </button>
                  </div>
                  {notesLoading ? (
                    <p className="bookdetail__muted">加载中…</p>
                  ) : notes.length === 0 ? (
                    <p className="bookdetail__muted">还没有笔记</p>
                  ) : (
                    <div className="bookdetail__noteGrid">
                      {notes.map((note) => (
                        <article
                          key={note.id}
                          className="bookdetail__noteItem"
                          onClick={() => void openNoteDetail(note.id)}
                        >
                          <div className="bookdetail__noteItemHead">
                            <strong>{note.title}</strong>
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
                          <p>{note.preview || '（空）'}</p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <p className="bookdetail__empty">先选一段</p>
          )}
        </aside>
      </div>

      {noteModalOpen && selectedParagraph && (
        <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
          <div className="bookdetail__modal">
            <div className="bookdetail__modalHead">
              <h3>添加笔记</h3>
              <button type="button" onClick={() => setNoteModalOpen(false)}>
                ×
              </button>
            </div>
            <input
              className="bookdetail__noteTitleInput"
              value={noteDraftTitle}
              onChange={(event) => setNoteDraftTitle(event.target.value)}
              placeholder="标题（可选）"
            />
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

      {noteDetail && (
        <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
          <div className="bookdetail__modal bookdetail__modal--note">
            <div className="bookdetail__modalHead">
              <h3>{noteDetail.title}</h3>
              <button type="button" onClick={() => setNoteDetail(null)}>
                ×
              </button>
            </div>
            <pre className="bookdetail__noteDetail">{noteDetail.content || '（空）'}</pre>
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
            <p className="bookdetail__confirmText">删除「{deleteTarget.title}」？此操作不可撤销。</p>
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
    .join('\n\n')
}
