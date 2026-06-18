/**
 * BookDetailView — shell component for the open-book screen. Wires the library
 * store's fetch actions to useEffect (tree → paragraphs → notes), and composes
 * the header + 3-column workspace + modals + toast from the page components.
 *
 * Pure View: state and business logic live in useLibraryStore (Model);
 * sub-views are in components/page/library/.
 */
import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '@/models/shared/session'
import { useLibraryStore } from '@/models/library/store'
import type { BookListItem } from '@/models/shared/types'
import { ChapterList } from '@/components/page/library/ChapterList'
import { ParagraphList } from '@/components/page/library/ParagraphList'
import { InspectorPanel } from '@/components/page/library/InspectorPanel'
import { NoteDrawer } from '@/components/page/library/NoteDrawer'
import { NoteEditorModal } from '@/components/page/library/NoteEditorModal'
import { ParagraphEditModal } from '@/components/page/library/ParagraphEditModal'
import { MergePreviewModal } from '@/components/page/library/MergePreviewModal'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'

interface BookDetailViewProps {
  book: BookListItem
  targetChapterId: string | null
  onBack: () => void
  /** Called after a book title edit so the parent (LibraryView) can refresh its list. */
  onBookUpdated?: () => void
}

export function BookDetailView({ book, targetChapterId, onBack, onBookUpdated }: BookDetailViewProps) {
  const activeParagraphId = useSessionStore((s) => s.activeParagraphId)
  const targetParagraphId = activeParagraphId

  const saveBookTitle = useLibraryStore((s) => s.saveBookTitle)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(book.title)
  const titleInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    }
  }, [editingTitle])

  // keep the draft in sync if the book prop changes (e.g. after a parent refresh)
  useEffect(() => {
    if (!editingTitle) setTitleDraft(book.title)
  }, [book.title, editingTitle])

  const commitTitle = async () => {
    const t = titleDraft.trim()
    if (!t) {
      setEditingTitle(false)
      setTitleDraft(book.title)
      return
    }
    if (t === book.title) {
      setEditingTitle(false)
      return
    }
    try {
      await saveBookTitle(book.id, t)
      onBookUpdated?.()
    } catch {
      setTitleDraft(book.title)
    } finally {
      setEditingTitle(false)
    }
  }

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

  // paragraph batch-delete confirm
  const deleteConfirmOpen = useLibraryStore((s) => s.deleteConfirmOpen)
  const setDeleteConfirmOpen = useLibraryStore((s) => s.setDeleteConfirmOpen)
  const selectedParagraphIdsForDelete = useLibraryStore((s) => s.selectedParagraphIds)
  const confirmDeleteSelected = useLibraryStore((s) => s.confirmDeleteSelected)

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
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="bookdetail__titleInput"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commitTitle()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setTitleDraft(book.title)
                  setEditingTitle(false)
                }
              }}
              onBlur={() => void commitTitle()}
            />
          ) : (
            <div className="bookdetail__titleRow">
              <h2 className="bookdetail__title">{book.title}</h2>
              <button
                type="button"
                className="bookdetail__editBtn bookdetail__editBtn--title"
                aria-label="编辑书名"
                title="编辑书名"
                onClick={() => setEditingTitle(true)}
              >
                ✎
              </button>
            </div>
          )}
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

      <ParagraphEditModal />
      <MergePreviewModal />

      <ConfirmModal
        open={deleteConfirmOpen}
        title="确认删除段落"
        message={`将删除 ${selectedParagraphIdsForDelete.length} 个段落，绑定笔记转为自由笔记。此操作不可撤销。`}
        confirmLabel="删除"
        busyLabel="删除中"
        onConfirm={() => void confirmDeleteSelected()}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      {toastMessage && (
        <div className="bookdetail__toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
