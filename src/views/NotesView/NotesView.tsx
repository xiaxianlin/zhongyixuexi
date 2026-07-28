/**
 * NotesView — "我的笔记" page. Shows free notes (paragraph_id IS NULL) — notes
 * orphaned when their book/chapter/paragraph was deleted. Users can edit or
 * delete them here so nothing is lost.
 *
 * Self-contained: manages its own state via notesApi (not the library store,
 * which is paragraph-bound). Editing reuses the same inline-edit pattern as
 * NoteDrawer.
 */
import { useCallback, useEffect, useState } from 'react'
import { notesApi } from '@/models/library/api'
import type { ParagraphNoteCard } from '@/models/library/types'
import { ConfirmModal } from '@/components/interaction/ConfirmModal'
import './notes.css'

export function NotesView() {
  const [notes, setNotes] = useState<ParagraphNoteCard[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ParagraphNoteCard | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setNotes(await notesApi.listFree())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startEdit = (note: ParagraphNoteCard) => {
    setEditingId(note.id)
    setEditDraft(note.content || '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const saveEdit = async () => {
    if (!editingId) return
    const content = editDraft.trim()
    if (!content) {
      setToast('笔记内容不能为空')
      return
    }
    try {
      await notesApi.update(editingId, content)
      setEditingId(null)
      setEditDraft('')
      setToast('已保存')
      await refresh()
    } catch (e) {
      setToast(`保存失败：${(e as Error).message}`)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await notesApi.delete(deleteTarget.id)
      setDeleteTarget(null)
      setToast('已删除')
      await refresh()
    } catch (e) {
      setToast(`删除失败：${(e as Error).message}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="notes-page">
      <header className="settings__hero notes-page__hero">
        <p className="settings__eyebrow">笔记</p>
        <h2>我的笔记</h2>
        <p>
          这里汇集了因原文删除而脱离段落的自由笔记。可编辑或删除，确保心得不会丢失。
        </p>
      </header>

      {toast && <p className="set-panel__msg">{toast}</p>}

      {loading ? (
        <p className="bookdetail__muted">加载中…</p>
      ) : notes.length === 0 ? (
        <p className="bookdetail__muted notes-page__empty">暂无自由笔记</p>
      ) : (
        <div className="notes-page__grid">
          {notes.map((note) => {
            const isEditing = editingId === note.id
            return (
              <article key={note.id} className="notes-page__card">
                <div className="notes-page__cardHead">
                  <button
                    type="button"
                    className="bookdetail__noteEdit"
                    title="编辑"
                    onClick={() => startEdit(note)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="bookdetail__noteDelete"
                    title="删除"
                    onClick={() => setDeleteTarget(note)}
                  >
                    ×
                  </button>
                </div>
                {isEditing ? (
                  <div className="bookdetail__noteEditArea">
                    <textarea
                      className="bookdetail__noteEditText"
                      value={editDraft}
                      autoFocus
                      onChange={(e) => setEditDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelEdit()
                        }
                      }}
                      rows={5}
                    />
                    <div className="bookdetail__noteEditActions">
                      <button type="button" className="bookdetail__btn" onClick={cancelEdit}>
                        取消
                      </button>
                      <button
                        type="button"
                        className="bookdetail__primary"
                        onClick={() => void saveEdit()}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="notes-page__text">{note.content || '（空）'}</p>
                )}
              </article>
            )
          })}
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title="删除笔记"
        message="确定删除这条笔记？此操作不可撤销。"
        confirmLabel="删除"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
