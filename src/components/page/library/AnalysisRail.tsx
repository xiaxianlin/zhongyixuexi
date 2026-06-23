/**
 * AnalysisRail — right column of BookDetailView (v3.1).
 *
 * D3 transitional shape: renders the active chapter-level analysis
 * (解读 / 医理 / 白话) read from chapterContent.analysis, plus the ExcerptsTab.
 * The full vertical 6-tab rail (对话 / 解读 / 医理 / 白话 / 笔记 / 摘录) lands
 * in slice D4; this keeps the right column meaningful while the paragraph-level
 * InspectorPanel is retired (reading is now chapter-level).
 */
import { useLibraryStore } from '@/models/library/store'
import { compactAnalysisText } from '@/models/library/helpers'
import { ExcerptsTab } from './rail/ExcerptsTab'

export function AnalysisRail() {
  const chapterContent = useLibraryStore((s) => s.chapterContent)
  const excerpts = useLibraryStore((s) => s.excerpts)
  const setExcerptDeleteTarget = useLibraryStore((s) => s.setExcerptDeleteTarget)
  const excerptDeleteTarget = useLibraryStore((s) => s.excerptDeleteTarget)
  const deleteExcerpt = useLibraryStore((s) => s.deleteExcerpt)

  const analysis = chapterContent?.analysis ?? null
  const analyzed = Boolean(analysis?.meta)

  return (
    <aside className="bookdetail__inspector bookdetail__rail" aria-label="析">
      <div className="bookdetail__inspectHead">
        <div className="bookdetail__railHead">析</div>
        {analyzed && <span className="bookdetail__parsedTag">已解析</span>}
      </div>

      <div className="bookdetail__inspectScroll bookdetail__railScroll">
        <section className="bookdetail__panelBlock">
          <div className="bookdetail__panelTitle">解读</div>
          {analysis?.analysis ? (
            <p className="bookdetail__analysisText">
              {compactAnalysisText(analysis.analysis)}
            </p>
          ) : (
            <p className="bookdetail__muted">本章尚未解读（点阅读区「AI 分析」生成，下一版本上线）</p>
          )}
        </section>

        <section className="bookdetail__panelBlock">
          <div className="bookdetail__panelTitle">医理</div>
          {analysis?.explanation ? (
            <p className="bookdetail__modernText">
              {compactAnalysisText(analysis.explanation)}
            </p>
          ) : (
            <p className="bookdetail__muted">暂无医理</p>
          )}
        </section>

        {analysis?.modern !== undefined && (
          <section className="bookdetail__panelBlock">
            <div className="bookdetail__panelTitle">白话</div>
            {analysis.modern ? (
              <p className="bookdetail__modernText">
                {compactAnalysisText(analysis.modern)}
              </p>
            ) : (
              <p className="bookdetail__muted">尚未生成</p>
            )}
          </section>
        )}

        <section className="bookdetail__panelBlock">
          <div className="bookdetail__panelTitle">摘录（{excerpts.length}）</div>
          <ExcerptsTab />
        </section>
      </div>

      {/* excerpt delete confirm reuses the ConfirmModal pattern inline */}
      {excerptDeleteTarget && (
        <div
          className="bookdetail__confirmInline"
          role="dialog"
          aria-label="删除摘录"
        >
          <p>删除这条摘录？</p>
          <button type="button" className="bookdetail__btn" onClick={() => setExcerptDeleteTarget(null)}>
            取消
          </button>
          <button
            type="button"
            className="bookdetail__primary"
            onClick={() => void deleteExcerpt(excerptDeleteTarget.id)}
          >
            删除
          </button>
        </div>
      )}
    </aside>
  )
}
