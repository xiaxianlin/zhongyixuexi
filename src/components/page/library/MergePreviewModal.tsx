/**
 * MergePreviewModal — preview the merged text before confirming a batch merge.
 * Reads selectedParagraphIds/paragraphs/mergePreviewOpen from the library store,
 * shows the paragraphs joined in chapter order (regardless of selection order),
 * and dispatches confirmMergeSelected / setMergePreviewOpen.
 *
 * Business component, page-level (bound to library store).
 */
import { useLibraryStore } from '@/models/library/store'
import { Modal } from '@/components/interaction/Modal'

export function MergePreviewModal() {
  const mergePreviewOpen = useLibraryStore((s) => s.mergePreviewOpen)
  const selectedParagraphIds = useLibraryStore((s) => s.selectedParagraphIds)
  const paragraphs = useLibraryStore((s) => s.paragraphs)
  const confirmMergeSelected = useLibraryStore((s) => s.confirmMergeSelected)
  const setMergePreviewOpen = useLibraryStore((s) => s.setMergePreviewOpen)

  if (!mergePreviewOpen) return null

  // join selected in chapter order_index order (not selection order)
  const selected = paragraphs.filter((p) => selectedParagraphIds.includes(p.id))
  const preview = selected.map((p) => p.text).join('\n\n———\n\n')

  return (
    <Modal
      title={`合并预览（${selected.length} 段）`}
      onClose={() => setMergePreviewOpen(false)}
      actions={
        <>
          <button type="button" className="bookdetail__btn" onClick={() => setMergePreviewOpen(false)}>
            取消
          </button>
          <button
            type="button"
            className="bookdetail__primary"
            onClick={() => void confirmMergeSelected()}
          >
            确认合并
          </button>
        </>
      }
    >
      <p className="bookdetail__confirmText">
        合并后将按章节顺序拼接为一个新的段落，原段落会被移除（绑定笔记转为自由笔记）。
      </p>
      <pre className="bookdetail__mergePreview">{preview}</pre>
    </Modal>
  )
}
