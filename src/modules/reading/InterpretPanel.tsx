/**
 * InterpretPanel — middle column (RD-03). Renders the AI interpretation
 * (content_modern + content_explanation) for each paragraph, locked 1:1 to the
 * original column by paragraph_id. Segments without a cached interpretation
 * render a placeholder "待 AI 解读" (Phase 5 AI module fills these columns).
 *
 * The scroll container is forwarded to ReadingWorkbench for useSyncScroll; the
 * sync direction is original → interpret by default (the original is the driver),
 * but either column can drive (see useSyncScroll).
 */
import { forwardRef } from 'react'
import { ParagraphBlock } from './ParagraphBlock'
import { useReadingStore } from './store'
import type { ParagraphDTO } from './types'

interface InterpretPanelProps {
  paragraphs: ParagraphDTO[]
}

export const InterpretPanel = forwardRef<HTMLDivElement, InterpretPanelProps>(
  function InterpretPanel({ paragraphs }, ref) {
    const topParagraphId = useReadingStore((s) => s.topParagraphId)
    const fontSize = useReadingStore((s) => s.layout.fontSize)

    // How many segments actually have interpretation (for the header summary).
    const generated = paragraphs.filter(
      (p) =>
        (p.content_modern != null && p.content_modern !== '') ||
        (p.content_explanation != null && p.content_explanation !== ''),
    ).length

    return (
      <section className="ipanel">
        <header className="ipanel__bar">
          <span className="ipanel__title">解读</span>
          <span className="ipanel__meta">
            {generated}/{paragraphs.length} 已生成
          </span>
        </header>

        <div
          className="ipanel__scroll"
          ref={ref}
          style={{ fontSize: `${Math.round(fontSize * 0.92)}px` }}
        >
          {paragraphs.length === 0 ? (
            <p className="ipanel__empty">无内容。</p>
          ) : (
            paragraphs.map((p) => (
              <ParagraphBlock
                key={p.id}
                paragraph={p}
                kind="interpret"
                active={p.id === topParagraphId}
              />
            ))
          )}
        </div>
      </section>
    )
  },
)
