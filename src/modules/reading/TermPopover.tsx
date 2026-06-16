/**
 * TermPopover — RD-05 inline term popover for the original column.
 *
 * Distinct from the SRH module's TermPopup (search/TermPopup.tsx): that one is a
 * full-screen modal driven by a selected dictionary_term's id (SRH-04 detail,
 * with occurrences). This one is a lightweight popover anchored to the user's
 * text selection in the original column and queried via reading:lookupTerm
 * (which reads dictionary_terms but degrades to not-found if SRH's table is
 * absent). When the local dictionary misses, an "AI 释义" affordance is shown
 * (placeholder — the AI call is Phase 5).
 *
 * Positioning: anchored below the selection rect; flips above if it would
 * overflow the viewport bottom (RD-05: 浮窗定位防越界). No floating-ui dep — a
 * small flip heuristic keeps the surface dependency-free.
 */
import { useEffect, useState } from 'react'
import { readingApi } from '@/lib/reading-api'
import type { TermLookupDTO } from './types'

export interface TermPopoverState {
  term: string
  rect: DOMRect
}

interface TermPopoverProps {
  target: TermPopoverState | null
  onClose: () => void
}

export function TermPopover({ target, onClose }: TermPopoverProps): React.ReactElement | null {
  const [result, setResult] = useState<TermLookupDTO | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!target) {
      setResult(null)
      return
    }
    let alive = true
    setLoading(true)
    setResult(null)
    void readingApi
      .lookupTerm(target.term)
      .then((r) => {
        if (alive) setResult(r)
      })
      .catch(() => {
        if (alive) setResult(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [target])

  // Esc closes the popover.
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, onClose])

  if (!target) return null

  // Flip heuristic: if the popover would render below the fold, place it above.
  const POP_H = 180 // approximate; the card is max-height bounded by CSS
  const spaceBelow = window.innerHeight - target.rect.bottom
  const above = spaceBelow < POP_H
  const top = above ? Math.max(8, target.rect.top - POP_H - 8) : target.rect.bottom + 8
  // Horizontal: clamp into the viewport with an 8px margin.
  const left = Math.min(
    Math.max(8, target.rect.left),
    window.innerWidth - 8 - 320, // card width ≈ 320px
  )

  return (
    <div className="rtpop-overlay" onClick={onClose}>
      <div
        className="rtpop"
        style={{ top, left }}
        role="dialog"
        aria-label={`词条：${target.term}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="rtpop__close" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <h4 className="rtpop__term">{target.term}</h4>
        {loading ? (
          <p className="rtpop__loading">查询中…</p>
        ) : result && result.found ? (
          <>
            {result.category && <span className="rtpop__cat">{result.category}</span>}
            <p className="rtpop__def">{result.definition}</p>
            {result.source && (
              <p className="rtpop__src">
                <span className="rtpop__label">出处：</span>
                {result.source}
              </p>
            )}
          </>
        ) : (
          <div className="rtpop__miss">
            <p className="rtpop__missmsg">本地词典暂无此条。</p>
            <button type="button" className="rtpop__ai" title="AI 释义将在 Phase 5 接入" disabled>
              AI 释义
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
