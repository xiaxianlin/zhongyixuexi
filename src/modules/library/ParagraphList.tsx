/**
 * Middle column of BookDetailView — the paragraph list for the selected
 * chapter. Reads paragraphs/contentLoading/selectedParagraphId from the store
 * and dispatches selectParagraph.
 */
import { useLibraryStore } from '@/stores/library'

export function ParagraphList() {
  const paragraphs = useLibraryStore((s) => s.paragraphs)
  const contentLoading = useLibraryStore((s) => s.contentLoading)
  const selectedParagraphId = useLibraryStore((s) => s.selectedParagraphId)
  const selectParagraph = useLibraryStore((s) => s.selectParagraph)

  return (
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
          <div className="bookdetail__paragraphScroll">
            {paragraphs.map((paragraph) => (
              <div
                key={paragraph.id}
                className={
                  paragraph.id === selectedParagraphId
                    ? 'bookdetail__paragraph is-active'
                    : 'bookdetail__paragraph'
                }
                onClick={() => selectParagraph(paragraph.id)}
              >
                <span className="bookdetail__paraText">{paragraph.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
