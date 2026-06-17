/**
 * TermPopup — SRH-04 terminology detail popup (definition + source + related).
 *
 * Renders when searchStore.activeTermDetail is set (opened via openTerm). The
 * "related occurrences" list shows paragraphs where the term appears; clicking
 * one jumps to it in the library detail page.
 *
 * No dangerouslySetInnerHTML: the definition/source are plain text.
 */

import { useSearchStore } from '@/stores/search'
import { useSessionStore } from '@/stores/session'
import type { TermOccurrence } from '@/lib/types'

function jumpToOccurrence(o: TermOccurrence): void {
  useSessionStore.getState().openBookDetail(o.bookId, o.chapterId, o.paragraphId)
  useSearchStore.getState().closeTerm()
}

export function TermPopup() {
  const detail = useSearchStore((s) => s.activeTermDetail)
  const loading = useSearchStore((s) => s.termDetailLoading)
  const close = useSearchStore((s) => s.closeTerm)

  if (loading) {
    return (
      <div className="termpopup termpopup--open" role="dialog" aria-modal="true">
        <div className="termpopup__card">
          <p className="termpopup__loading">载入术语…</p>
          <button className="termpopup__close" onClick={close} aria-label="关闭">
            ×
          </button>
        </div>
      </div>
    )
  }

  if (!detail) return null

  return (
    <div className="termpopup termpopup--open" role="dialog" aria-modal="true" onClick={close}>
      <div className="termpopup__card" onClick={(e) => e.stopPropagation()}>
        <button className="termpopup__close" onClick={close} aria-label="关闭">
          ×
        </button>
        <h3 className="termpopup__term">{detail.term}</h3>
        {detail.category && <span className="termpopup__cat">{detail.category}</span>}
        {detail.definition ? (
          <p className="termpopup__def">{detail.definition}</p>
        ) : (
          <p className="termpopup__def termpopup__def--empty">暂无释义。</p>
        )}
        {detail.source && (
          <p className="termpopup__src">
            <span className="termpopup__label">出处：</span>
            {detail.source}
          </p>
        )}

        <div className="termpopup__occ">
          <div className="termpopup__occhead">
            出现于 {detail.occurrences.length} 段
          </div>
          {detail.occurrences.length === 0 ? (
            <p className="termpopup__occempty">暂无关联段落。</p>
          ) : (
            <ul className="termpopup__occlist">
              {detail.occurrences.map((o) => (
                <li
                  key={o.paragraphId}
                  className="termpopup__occitem"
                  onClick={() => jumpToOccurrence(o)}
                >
                  <span className="termpopup__occloc">
                    {o.bookTitle} › {o.chapterTitle}
                  </span>
                  <span className="termpopup__occcount">×{o.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
