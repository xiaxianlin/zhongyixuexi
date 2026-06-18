/**
 * ParagraphEditModal — modal for editing a single paragraph's text (opened via
 * the ✎ button on a paragraph). Reads editingParagraphId/paragraphDraft from the
 * library store and dispatches saveParagraphText / splitParagraphAtOffset /
 * cancelEditParagraph. Split uses the textarea caret position.
 *
 * Business component, page-level (bound to library store).
 */
import { useEffect, useRef } from 'react'
import { useLibraryStore } from '@/models/library/store'

export function ParagraphEditModal() {
  const editingParagraphId = useLibraryStore((s) => s.editingParagraphId)
  const paragraphDraft = useLibraryStore((s) => s.paragraphDraft)
  const setParagraphDraft = useLibraryStore((s) => s.setParagraphDraft)
  const saveParagraphText = useLibraryStore((s) => s.saveParagraphText)
  const splitParagraphAtOffset = useLibraryStore((s) => s.splitParagraphAtOffset)
  const cancelEditParagraph = useLibraryStore((s) => s.cancelEditParagraph)

  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (editingParagraphId) ref.current?.focus()
  }, [editingParagraphId])

  if (!editingParagraphId) return null

  const handleSplit = () => {
    const offset = ref.current?.selectionStart ?? -1
    if (offset <= 0) {
      window.alert('请先把光标放在要拆分的位置')
      return
    }
    void splitParagraphAtOffset(offset)
  }

  return (
    <div className="bookdetail__modalBackdrop" role="dialog" aria-modal="true">
      <div className="bookdetail__modal">
        <div className="bookdetail__modalHead">
          <h3>编辑段落</h3>
          <button type="button" onClick={cancelEditParagraph}>
            ×
          </button>
        </div>
        <textarea
          ref={ref}
          className="bookdetail__paraTextarea bookdetail__paraTextarea--modal"
          value={paragraphDraft}
          onChange={(e) => setParagraphDraft(e.target.value)}
          rows={10}
        />
        <div className="bookdetail__modalActions">
          <button type="button" className="bookdetail__btn" onClick={cancelEditParagraph}>
            取消
          </button>
          <button type="button" className="bookdetail__btn" onClick={handleSplit}>
            在光标处拆分
          </button>
          <button
            type="button"
            className="bookdetail__primary"
            onClick={() => void saveParagraphText()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
