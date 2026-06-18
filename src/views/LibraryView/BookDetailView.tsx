/**
 * BookDetailView — shell component for the open-book screen. Wires the library
 * store's fetch actions to useEffect (tree → paragraphs → notes), and composes
 * the header + 3-column workspace + modals + toast from the page components.
 *
 * Pure View: state and business logic live in useLibraryStore (Model);
 * sub-views are in components/page/library/.
 */
import { useEffect } from 'react'
import { useSessionStore } from '@/models/shared/session'
import { useLibraryStore } from '@/models/library/store'
import type { BookListItem } from '@/models/shared/types'
import { ChapterList } from '@/components/page/library/ChapterList'
import { ParagraphList } from '@/components/page/library/ParagraphList'
import { InspectorPanel } from '@/components/page/library/InspectorPanel'
import { NoteDrawer } from '@/components/page/library/NoteDrawer'
import { NoteEditorModal } from '@/components/page/library/NoteEditorModal'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'

interface BookDetailViewProps {
  book: BookListItem
  targetChapterId: string | null
  onBack: () => void
}

export function BookDetailView({ book, targetChapterId, onBack }: BookDetailViewProps) {
  const activeParagraphId = useSessionStore((s) => s.activeParagraphId)
  const targetParagraphId = activeParagraphId

  const fetchTree = useLibraryStore((s) => s.fetchTree)
  const selectedChapterId = useLibraryStore((s) => s.selectedChapterId)
  const fetchParagraphs = useLibraryStore((s) => s.fetchParagraphs)
  const selectedParagraphId = useLibraryStore((s) => s.selectedParagraphId)
  const fetchNotes = useLibraryStore((s) => s.fetchNotes)

  const notes = useLibraryStore((s) => s.notes)
  const notesLoading = useLibraryStore((s) => s.notesLoading)
  const paragraphs = useLibraryStore((s) => s.paragraphs)
  const setNoteModalOpen = useLibraryStore((s) => s.setNoteModalOpen)
  const setNoteDrawerOpen = useLibraryStore((s) => s.setNoteDrawerOpen)

  const deleteTarget = useLibraryStore((s) => s.deleteTarget)
  const deletingNote = useLibraryStore((s) => s.deletingNote)
  const setDeleteTarget = useLibraryStore((s) => s.setDeleteTarget)
  const deleteNote = useLibraryStore((s) => s.deleteNote)

  const reanalyzeConfirmOpen = useLibraryStore((s) => s.reanalyzeConfirmOpen)
  const setReanalyzeConfirmOpen = useLibraryStore((s) => s.setReanalyzeConfirmOpen)
  const aiGenerating = useLibraryStore((s) => s.aiGenerating)
  const runAnalysis = useLibraryStore((s) => s.runAnalysis)

  const toastMessage = useLibraryStore((s) => s.toastMessage)

  const selectedParagraph =
    paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? null

  // Load tree on book / targetChapterId change.
  useEffect(() => {
    void fetchTree(book.id, targetChapterId)
  }, [book.id, targetChapterId, fetchTree])

  // Load paragraphs when selectedChapterId changes (or targetParagraphId, which
  // may re-resolve against the same chapter).
  useEffect(() => {
    if (!selectedChapterId) return
    void fetchParagraphs(book.id, selectedChapterId, targetParagraphId)
  }, [book.id, selectedChapterId, targetParagraphId, fetchParagraphs])

  // Load notes when selectedParagraphId changes.
  useEffect(() => {
    void fetchNotes(selectedParagraphId)
  }, [selectedParagraphId, fetchNotes])

  return (
    <div className="bookdetail">
      <header className="bookdetail__header">
        <button
          type="button"
          className="bookdetail__back"
          onClick={onBack}
          title="返回书库"
          aria-label="返回书库"
        />
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
        <ChapterList />
        <ParagraphList />
        <InspectorPanel />
      </div>

      <NoteDrawer />
      <NoteEditorModal bookId={book.id} chapterId={selectedChapterId} />

      <ConfirmModal
        open={deleteTarget !== null}
        title="确认删除"
        message="删除这篇笔记？此操作不可撤销。"
        confirmLabel="删除"
        busyLabel="删除中"
        busy={deletingNote}
        onConfirm={() => void deleteNote()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmModal
        open={reanalyzeConfirmOpen}
        title="重新分析"
        message="当前段落已有分析内容。重新分析会覆盖白话、医理和解读。"
        confirmLabel="确认覆盖"
        busy={aiGenerating}
        onConfirm={() => {
          setReanalyzeConfirmOpen(false)
          window.requestAnimationFrame(() => {
            void runAnalysis(true)
          })
        }}
        onCancel={() => setReanalyzeConfirmOpen(false)}
      />

      {toastMessage && (
        <div className="bookdetail__toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
