/**
 * InspectorPanel — right column of BookDetailView (business component,
 * page-level). The "析" (analysis) inspector: shows the selected paragraph's
 * interpretation (modern / explanation / analysis) and the AI generate button.
 * Reads selectedParagraph/aiGenerating from the store and dispatches
 * requestAnalysis.
 */
import { useLibraryStore } from '@/models/library/store'
import { compactAnalysisText } from '@/models/library/helpers'

export function InspectorPanel() {
  const paragraphs = useLibraryStore((s) => s.paragraphs)
  const selectedParagraphId = useLibraryStore((s) => s.selectedParagraphId)
  const aiGenerating = useLibraryStore((s) => s.aiGenerating)
  const requestAnalysis = useLibraryStore((s) => s.requestAnalysis)

  const selectedParagraph =
    paragraphs.find((paragraph) => paragraph.id === selectedParagraphId) ?? null
  const selectedInterpretation = selectedParagraph?.interpretation ?? null
  const analyzed = Boolean(selectedInterpretation?.meta)

  if (!selectedParagraph) {
    return (
      <aside className="bookdetail__inspector" aria-label="段落操作">
        <p className="bookdetail__empty">先选一段</p>
      </aside>
    )
  }

  return (
    <aside className="bookdetail__inspector" aria-label="段落操作">
      {aiGenerating && (
        <div className="bookdetail__analysisOverlay" aria-live="polite">
          <span className="bookdetail__analysisSpinner" aria-hidden />
          <span>分析中</span>
        </div>
      )}
      <div className="bookdetail__inspectHead">
        <div>
          <div className="bookdetail__railTitleRow">
            <div className="bookdetail__railHead">析</div>
            {analyzed && <span className="bookdetail__parsedTag">已解析</span>}
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

      <div className="bookdetail__inspectScroll" style={aiGenerating ? { overflow: 'hidden' } : undefined}>
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

        <section className="bookdetail__panelBlock">
          <div className="bookdetail__panelTitle">医理</div>
          {selectedInterpretation?.explanation ? (
            <p className="bookdetail__modernText">
              {compactAnalysisText(selectedInterpretation.explanation)}
            </p>
          ) : (
            <p className="bookdetail__muted">暂无点拨</p>
          )}
        </section>

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
      </div>
    </aside>
  )
}
