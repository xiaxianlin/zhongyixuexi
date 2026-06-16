/**
 * OriginalPanel — left column (RD-02). Renders the chapter's source paragraphs in
 * 仿宋 serif with classical typography (line-height 1.7, segment spacing), and
 * the 繁简/拼音 toggles as switchable placeholders (S2.2: the toggle state lives
 * in component state, the data pipeline is not wired — see ParagraphBlock).
 *
 * The scroll container is forwarded up to ReadingWorkbench so useSyncScroll can
 * attach its listeners; this panel never owns the sync algorithm.
 *
 * Progress tracking: an IntersectionObserver watches the rendered segments and
 * reports the top-most visible paragraph id (+ a coarse within-segment ratio) to
 * the reading store, which useProgress debounces into reading_progress (RD-08).
 */
import { forwardRef, useEffect, useRef, useState } from 'react'
import { ParagraphBlock } from './ParagraphBlock'
import { useReadingStore } from './store'
import type { ParagraphDTO } from './types'

export interface TermPopoverTarget {
  term: string
  rect: DOMRect
}

interface OriginalPanelProps {
  paragraphs: ParagraphDTO[]
  onTerm?: (target: TermPopoverTarget) => void
}

export const OriginalPanel = forwardRef<HTMLDivElement, OriginalPanelProps>(
  function OriginalPanel({ paragraphs, onTerm }, ref) {
    const fontSize = useReadingStore((s) => s.layout.fontSize)
    const lineHeight = useReadingStore((s) => s.layout.lineHeight)
    const topParagraphId = useReadingStore((s) => s.topParagraphId)
    const setTopParagraph = useReadingStore((s) => s.setTopParagraph)
    const loading = useReadingStore((s) => s.loading)

    // S2.2 toggles — placeholder state; the rendering/data path is a no-op until
    // the OpenCC table (繁简) and IMP-05 ruby data (拼音) land. Toggling is
    // surfaced in the UI so the affordance exists per spec.
    const [showPinyin, setShowPinyin] = useState(false)
    const [simplified, setSimplified] = useState(true)

    // Local scroll node (the forwarded ref points at this). We attach observers
    // via the local ref and forward it; useSyncScroll reads the same element.
    const scrollRef = useRef<HTMLDivElement | null>(null)

    // Merge forwarded ref + local ref.
    useEffect(() => {
      if (typeof ref === 'function') ref(scrollRef.current)
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = scrollRef.current
    })

    // IntersectionObserver: report the top-most visible segment to the store for
    // progress (RD-08). Throttled via rAF so rapid scrolling doesn't storm the
    // store (the store write itself triggers useProgress's debounce).
    useEffect(() => {
      const root = scrollRef.current
      if (!root || paragraphs.length === 0) return
      const raf: { id: number | null } = { id: null }

      const io = new IntersectionObserver(
        (entries) => {
          // Collect segments currently intersecting, pick the one with the
          // smallest top (closest to the viewport top of the scroll container).
          const visible = entries
            .filter((e) => e.isIntersecting)
            .map((e) => ({
              id: (e.target as HTMLElement).dataset.paragraphId ?? '',
              top: e.boundingClientRect.top,
            }))
            .filter((v) => v.id)
          if (visible.length === 0) return
          visible.sort((a, b) => a.top - b.top)
          const top = visible[0]!
          if (raf.id != null) cancelAnimationFrame(raf.id)
          raf.id = requestAnimationFrame(() => {
            raf.id = null
            // ratio is approximate: based on how far the segment's top sits below
            // the container's top edge, normalized by its height. Good enough for
            // restore; the precise anchor is re-derived on open via findAnchor.
            const el = root.querySelector<HTMLElement>(
              `[data-paragraph-id="${cssEscape(top.id)}"]`,
            )
            const ratio =
              el && el.offsetHeight > 0
                ? Math.min(1, Math.max(0, (top.top - root.getBoundingClientRect().top) / el.offsetHeight))
                : 0
            setTopParagraph(top.id, ratio)
          })
        },
        { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
      )

      const blocks = root.querySelectorAll<HTMLElement>('[data-paragraph-id]')
      blocks.forEach((b) => io.observe(b))
      return () => {
        io.disconnect()
        if (raf.id != null) cancelAnimationFrame(raf.id)
      }
    }, [paragraphs, setTopParagraph])

    return (
      <section className="opanel">
        <header className="opanel__bar">
          <span className="opanel__title">原文</span>
          <div className="opanel__toggles">
            <button
              type="button"
              className={`opanel__toggle${simplified ? ' opanel__toggle--on' : ''}`}
              onClick={() => setSimplified((v) => !v)}
              title="繁简切换（数据待接入）"
            >
              {simplified ? '简' : '繁'}
            </button>
            <button
              type="button"
              className={`opanel__toggle${showPinyin ? ' opanel__toggle--on' : ''}`}
              onClick={() => setShowPinyin((v) => !v)}
              title="拼音/注音（数据待接入）"
            >
              拼
            </button>
          </div>
        </header>

        <div
          className="opanel__scroll"
          ref={scrollRef}
          style={{ fontSize: `${fontSize}px`, lineHeight }}
        >
          {loading && paragraphs.length === 0 ? (
            <p className="opanel__empty">加载中…</p>
          ) : paragraphs.length === 0 ? (
            <p className="opanel__empty">本章无内容，请在导入校对中检查。</p>
          ) : (
            paragraphs.map((p) => (
              <ParagraphBlock
                key={p.id}
                paragraph={p}
                kind="original"
                active={p.id === topParagraphId}
                showPinyin={showPinyin}
                simplified={simplified}
                onTerm={
                  onTerm
                    ? (term, rect) => onTerm({ term, rect })
                    : undefined
                }
              />
            ))
          )}
        </div>
      </section>
    )
  },
)

/** Minimal CSS-escape for the attribute selector (ids are UUIDs, safe chars). */
function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&')
}
