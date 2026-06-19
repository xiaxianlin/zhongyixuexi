/**
 * ParagraphEditModal — modal for editing a single paragraph's text OR creating
 * a new one (opened via the ✎ button or the ＋段 button). Reuses the shared
 * Modal shell. Two modes driven by store state:
 *  - edit:  editingParagraphId set → 保存 calls saveParagraphText, ＋拆分 available
 *  - create: paragraphCreateChapterId set → 新建 calls saveNewParagraph, no split
 *
 * Business component, page-level (bound to library store).
 */
import { useEffect, useRef } from 'react'
import { useLibraryStore } from '@/models/library/store'
import { Modal } from '@/components/interaction/Modal'

export function ParagraphEditModal() {
  const editingParagraphId = useLibraryStore((s) => s.editingParagraphId)
  const paragraphCreateChapterId = useLibraryStore((s) => s.paragraphCreateChapterId)
  const paragraphDraft = useLibraryStore((s) => s.paragraphDraft)
  const setParagraphDraft = useLibraryStore((s) => s.setParagraphDraft)
  const saveParagraphText = useLibraryStore((s) => s.saveParagraphText)
  const splitParagraphAtOffset = useLibraryStore((s) => s.splitParagraphAtOffset)
  const cancelEditParagraph = useLibraryStore((s) => s.cancelEditParagraph)
  const cancelCreateParagraph = useLibraryStore((s) => s.cancelCreateParagraph)
  const saveNewParagraph = useLibraryStore((s) => s.saveNewParagraph)
  const showToast = useLibraryStore((s) => s.showToast)

  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (editingParagraphId || paragraphCreateChapterId) ref.current?.focus()
  }, [editingParagraphId, paragraphCreateChapterId])

  const isCreating = paragraphCreateChapterId !== null
  // neither edit nor create → render nothing
  if (!editingParagraphId && !isCreating) return null

  const onClose = isCreating ? cancelCreateParagraph : cancelEditParagraph
  const onSubmit = isCreating ? saveNewParagraph : saveParagraphText

  const handleSplit = () => {
    const offset = ref.current?.selectionStart ?? -1
    if (offset <= 0) {
      showToast('请先把光标放在要拆分的位置')
      return
    }
    void splitParagraphAtOffset(offset)
  }

  return (
    <Modal
      title={isCreating ? '新建段落' : '编辑段落'}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="bookdetail__btn" onClick={onClose}>
            取消
          </button>
          {!isCreating && (
            <button type="button" className="bookdetail__btn" onClick={handleSplit}>
              在光标处拆分
            </button>
          )}
          <button type="button" className="bookdetail__primary" onClick={() => void onSubmit()}>
            {isCreating ? '新建' : '保存'}
          </button>
        </>
      }
    >
      <textarea
        ref={ref}
        className="bookdetail__paraTextarea bookdetail__paraTextarea--modal"
        value={paragraphDraft}
        onChange={(e) => setParagraphDraft(e.target.value)}
        rows={10}
      />
    </Modal>
  )
}
