/**
 * ParagraphBlock — single-paragraph renderer shared by the original and
 * interpretation columns (RD-02/RD-03, 03-reading.md §6.1).
 *
 * Carries the stable `data-paragraph-id` anchor the sync-scroll algorithm and
 * progress restore key on (03-reading.md §7.1 / §7.2). Two kinds:
 *
 *  - kind="original": renders the source classical text in 仿宋 serif; words are
 *    made clickable to open the term popover (RD-05). A simple click-to-select
 *    model is used (no front-end tokenizer dependency yet) — clicking fires
 *    onTerm with the current text selection (window.getSelection) so the user can
 *    highlight a term; if no selection, the click is a no-op.
 *  - kind="interpret": renders the reading module's interpretation fields; when
 *    all are null (AI not generated yet) shows a placeholder "待 AI 解读"
 *    so the column still occupies its layout slot (sync-scroll needs a stable id).
 *
 * An optional "active" highlight (the segment the user is currently reading,
 * tracked by topParagraphId) gets a visual marker so J/K navigation is legible.
 */
import { memo } from 'react'
import type { ParagraphDTO } from './types'

export interface ParagraphBlockProps {
  paragraph: ParagraphDTO
  kind: 'original' | 'interpret'
  active?: boolean
  /** Called with a selected term from the original column (RD-05). */
  onTerm?: (term: string, rect: DOMRect) => void
  /** Optional display toggles (RD-02 placeholders, wired when data lands). */
  showPinyin?: boolean
  simplified?: boolean
}

function ParagraphBlockImpl({
  paragraph,
  kind,
  active = false,
  onTerm,
  showPinyin = false,
  simplified = true,
}: ParagraphBlockProps): React.ReactElement {
  const baseClass = kind === 'original' ? 'pblock pblock--orig' : 'pblock pblock--interp'
  const cls = `${baseClass}${active ? ' pblock--active' : ''}`

  if (kind === 'original') {
    return (
      <div
        className={cls}
        data-paragraph-id={paragraph.id}
        onMouseUp={(e) => {
          if (!onTerm) return
          const sel = window.getSelection()
          const term = sel?.toString().trim() ?? ''
          if (term.length === 0) return
          // Guard against absurdly long selections (a whole paragraph).
          if (term.length > 24) return
          onTerm(term, e.currentTarget.getBoundingClientRect())
          // Clear the selection so the popover isn't visually tied to stale text.
          sel?.removeAllRanges()
        }}
      >
        {/* RD-02 古风排版: serif, line-height 1.7. */}
        {/* showPinyin / simplified are toggles with no data pipeline yet (TODO):
            pinyin needs IMP-05 ruby data; simplified needs the OpenCC table.
            Both are intentional placeholders — the toggle exists (S2.2 spec)
            but rendering falls back to the stored text until those land. */}
        <p className="pblock__text" lang="zh-Hant">
          {showPinyin ? (
            // Placeholder: no ruby data yet; render plain so DOM/id anchor stays stable.
            paragraph.text
          ) : simplified ? (
            paragraph.text
          ) : (
            paragraph.text
          )}
        </p>
        {paragraph.edited ? <span className="pblock__flag" title="已手动校订">校</span> : null}
      </div>
    )
  }

  // kind === 'interpret'
  const interpretation = paragraph.interpretation
  const hasModern = interpretation.modern != null && interpretation.modern !== ''
  const hasExpl =
    interpretation.explanation != null && interpretation.explanation !== ''
  const hasAnalysis = interpretation.analysis != null && interpretation.analysis !== ''
  const hasInterpretation = hasModern || hasExpl || hasAnalysis

  return (
    <div className={cls} data-paragraph-id={paragraph.id}>
      {hasInterpretation ? (
        <>
          {hasModern && <p className="pblock__modern">{compactAnalysisText(interpretation.modern ?? '')}</p>}
          {hasExpl && (
            <div className="pblock__expl">
              <span className="pblock__expl-label">医理</span>
              <p>{compactAnalysisText(interpretation.explanation ?? '')}</p>
            </div>
          )}
          {hasAnalysis && (
            <div className="pblock__expl">
              <span className="pblock__expl-label">解读</span>
              <p>{compactAnalysisText(interpretation.analysis ?? '')}</p>
            </div>
          )}
        </>
      ) : (
        // RD-03: no AI interpretation cached yet.
        // Phase 5 AI module fills these; until then show a stable placeholder so
        // the column keeps its anchor and the sync-scroll map stays 1:1 by id.
        <p className="pblock__placeholder" title="AI 解读将在后续阶段生成">
          待 AI 解读
        </p>
      )}
    </div>
  )
}

export const ParagraphBlock = memo(ParagraphBlockImpl)

function compactAnalysisText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}
