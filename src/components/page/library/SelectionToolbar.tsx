/**
 * SelectionToolbar — floating 3-button toolbar that appears above a text
 * selection in the reading pane (摘录 / 写笔记 / 引用).
 *
 * Driven by parent state: the parent reads the selection offsets (via
 * getOffsetsFromSelection), computes the toolbar position from the selection's
 * bounding rect, and passes {selection, rect, onExcerpt, onNote, onQuote}.
 *
 * The「引用」button is disabled until slice D5 wires the chat pane (the parent
 * also disables it when no AI key is configured — passed via `quoteEnabled`).
 */
import type { ResolvedSelection } from './TextBlock'

interface SelectionToolbarProps {
  selection: ResolvedSelection | null
  /** Viewport-relative rect to anchor against (from getBoundingClientRect). */
  rect: DOMRect | null
  quoteEnabled: boolean
  onExcerpt: (selection: ResolvedSelection) => void
  onNote: (selection: ResolvedSelection) => void
  onQuote: (selection: ResolvedSelection) => void
}

export function SelectionToolbar({
  selection,
  rect,
  quoteEnabled,
  onExcerpt,
  onNote,
  onQuote,
}: SelectionToolbarProps) {
  if (!selection || !rect) return null
  // place above the selection, horizontally centered; clamp into the viewport
  const top = Math.max(8, rect.top - 48)
  const left = Math.min(
    Math.max(8, rect.left + rect.width / 2 - 80),
    window.innerWidth - 168,
  )
  return (
    <div
      className="seltb"
      style={{ top: `${top}px`, left: `${left}px` }}
      role="toolbar"
      aria-label="选区操作"
      // stop the toolbar click from clearing the selection / bubbling to the pane
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="seltb__btn"
        title="存为摘录"
        onClick={() => onExcerpt(selection)}
      >
        摘录
      </button>
      <button
        type="button"
        className="seltb__btn"
        title="写笔记"
        onClick={() => onNote(selection)}
      >
        写笔记
      </button>
      <button
        type="button"
        className="seltb__btn"
        disabled={!quoteEnabled}
        title={quoteEnabled ? '引用到 AI 对话' : '引用将在对话功能上线后可用'}
        onClick={() => quoteEnabled && onQuote(selection)}
      >
        引用
      </button>
    </div>
  )
}
