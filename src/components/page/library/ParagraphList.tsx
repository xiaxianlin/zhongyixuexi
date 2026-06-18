/**
 * ParagraphList — middle column of BookDetailView (business component,
 * page-level). The paragraph list for the selected chapter. Reads
 * paragraphs/contentLoading/selectedParagraphId from the store and dispatches
 * selectParagraph.
 *
 * Two interaction modes:
 *  - Normal: each paragraph has a ✎ button (opens ParagraphEditModal) + is
 *    clickable to select. The header has a 「管理」 button to enter manage mode.
 *  - Manage: each paragraph shows a checkbox; the header actions become
 *    合并 / 删除 / 取消. Merge opens a preview modal; delete opens a confirm modal.
 */
import { useLibraryStore } from '@/models/library/store'

export function ParagraphList() {
  const paragraphs = useLibraryStore((s) => s.paragraphs)
  const contentLoading = useLibraryStore((s) => s.contentLoading)
  const selectedParagraphId = useLibraryStore((s) => s.selectedParagraphId)
  const selectParagraph = useLibraryStore((s) => s.selectParagraph)

  const manageMode = useLibraryStore((s) => s.manageMode)
  const selectedParagraphIds = useLibraryStore((s) => s.selectedParagraphIds)
  const enterManageMode = useLibraryStore((s) => s.enterManageMode)
  const exitManageMode = useLibraryStore((s) => s.exitManageMode)
  const toggleParagraphSelected = useLibraryStore((s) => s.toggleParagraphSelected)
  const selectAllParagraphs = useLibraryStore((s) => s.selectAllParagraphs)
  const setMergePreviewOpen = useLibraryStore((s) => s.setMergePreviewOpen)
  const setDeleteConfirmOpen = useLibraryStore((s) => s.setDeleteConfirmOpen)

  const startEditParagraph = useLibraryStore((s) => s.startEditParagraph)

  const hasSelection = selectedParagraphIds.length > 0
  const canMerge = selectedParagraphIds.length >= 2

  return (
    <section className="bookdetail__paragraphs">
      <div className="bookdetail__paraHead">
        <div>
          <div className="bookdetail__railHead">段</div>
        </div>
        <div className="bookdetail__paraActions">
          {manageMode ? (
            <>
              <button
                type="button"
                className="bookdetail__btn"
                onClick={selectAllParagraphs}
                disabled={paragraphs.length === 0}
              >
                全选
              </button>
              <button
                type="button"
                className="bookdetail__btn"
                onClick={() => setMergePreviewOpen(true)}
                disabled={!canMerge}
                title={canMerge ? '合并选中的段落（预览后确认）' : '至少选择 2 段'}
              >
                合并
              </button>
              <button
                type="button"
                className="bookdetail__btn"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={!hasSelection}
                title={hasSelection ? '删除选中的段落' : '先选择段落'}
              >
                删除
              </button>
              <button type="button" className="bookdetail__btn" onClick={exitManageMode}>
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bookdetail__btn"
              onClick={enterManageMode}
              disabled={paragraphs.length === 0}
            >
              管理
            </button>
          )}
        </div>
      </div>

      {contentLoading ? (
        <p className="bookdetail__empty">加载段落…</p>
      ) : paragraphs.length === 0 ? (
        <p className="bookdetail__empty">本章暂无段落</p>
      ) : (
        <div className="bookdetail__paragraphList">
          <div className="bookdetail__paragraphScroll">
            {paragraphs.map((paragraph) => {
              const checked = selectedParagraphIds.includes(paragraph.id)
              return (
                <div
                  key={paragraph.id}
                  className={
                    !manageMode && paragraph.id === selectedParagraphId
                      ? 'bookdetail__paragraph is-active'
                      : 'bookdetail__paragraph'
                  }
                  onClick={() =>
                    manageMode
                      ? toggleParagraphSelected(paragraph.id)
                      : selectParagraph(paragraph.id)
                  }
                >
                  {manageMode ? (
                    <span
                      className={
                        checked
                          ? 'bookdetail__checkbox is-checked'
                          : 'bookdetail__checkbox'
                      }
                      aria-hidden
                    />
                  ) : null}
                  <span className="bookdetail__paraText">{paragraph.text}</span>
                  {!manageMode && (
                    <button
                      type="button"
                      className="bookdetail__editBtn bookdetail__editBtn--para"
                      aria-label="编辑段落"
                      title="编辑段落"
                      onClick={(e) => {
                        e.stopPropagation()
                        startEditParagraph(paragraph.id, paragraph.text)
                      }}
                    >
                      ✎
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
