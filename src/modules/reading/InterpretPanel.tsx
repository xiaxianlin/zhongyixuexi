/**
 * InterpretPanel — middle column (RD-03). Renders the AI interpretation
 * fields returned by the reading module for each paragraph, locked 1:1 to the
 * original column by paragraph_id. Segments without a cached interpretation
 * render a placeholder "待 AI 解读".
 *
 * The "生成解读" button triggers `ai:generateModern` for the top paragraph,
 * then reloads the chapter content while preserving the reading position.
 */
import { forwardRef } from 'react'
import { ParagraphBlock } from './ParagraphBlock'
import { useReadingStore } from './store'
import { readingApi } from '@/lib/reading-api'
import { aiApi } from '@/lib/ai-api'
import { useAiStore } from '@/stores/ai'
import type { ParagraphDTO } from './types'

interface InterpretPanelProps {
  paragraphs: ParagraphDTO[]
}

/** Re-fetch the chapter (picks up the active paragraph analysis) keeping position. */
async function reloadChapterKeepPosition(): Promise<void> {
  const st = useReadingStore.getState()
  const { bookId, chapterId, topParagraphId, scrollRatio } = st
  if (!bookId || !chapterId) return
  const c = await readingApi.getChapter(bookId, chapterId)
  if (!c) return
  st.setChapter(bookId, chapterId, c.chapter.title, c.paragraphs)
  if (topParagraphId) st.setTopParagraph(topParagraphId, scrollRatio)
}

export const InterpretPanel = forwardRef<HTMLDivElement, InterpretPanelProps>(
  function InterpretPanel({ paragraphs }, ref) {
    const topParagraphId = useReadingStore((s) => s.topParagraphId)
    const fontSize = useReadingStore((s) => s.layout.fontSize)
    const run = useAiStore((s) => s.run)

    // How many segments actually have interpretation (for the header summary).
    const generated = paragraphs.filter(
      (p) =>
        (p.interpretation.modern != null && p.interpretation.modern !== '') ||
        (p.interpretation.explanation != null && p.interpretation.explanation !== '') ||
        (p.interpretation.analysis != null && p.interpretation.analysis !== ''),
    ).length

    const onGenerate = (): void => {
      if (!topParagraphId) return
      void run(() => aiApi.generateModern(topParagraphId)).then((r) => {
        if (r) void reloadChapterKeepPosition()
      })
    }

    return (
      <section className="ipanel">
        <header className="ipanel__bar">
          <span className="ipanel__title">解读</span>
          <span className="ipanel__meta">
            {generated}/{paragraphs.length} 已生成
          </span>
          {topParagraphId && (
            <button
              className="app__navBtn"
              onClick={onGenerate}
              title="为当前段生成白话解读（DeepSeek）"
            >
              生成解读
            </button>
          )}
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
