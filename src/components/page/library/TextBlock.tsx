/**
 * TextBlock — renders chapter content as plain text with optional highlight
 * ranges, and resolves the DOM Selection against `content` into UTF-16 offsets.
 *
 * The text is rendered as a single text node per segment so that
 * getOffsetsFromSelection can walk the nodes and accumulate code-unit offsets
 * deterministically. Highlights are produced by splitting `content` at range
 * boundaries (sorted, non-overlapping) and wrapping the命中 segments in <mark>.
 */
import { useMemo, useRef } from 'react'

export interface HighlightRange {
  start: number
  end: number
  /** 'excerpt' | 'note' — drives the mark className. */
  kind: 'excerpt' | 'note'
}

export interface ResolvedSelection {
  start: number
  end: number
  text: string
}

interface TextBlockProps {
  content: string
  ranges?: HighlightRange[]
  /** Ref to the rendered text container (used by the parent to read selection). */
  containerRef?: React.MutableRefObject<HTMLDivElement | null>
}

/** Split `content` into ordered segments tagged with whether each is highlighted
 *  (and which kind). Ranges are clamped + de-overlapped first. */
function buildSegments(
  content: string,
  ranges: HighlightRange[],
): { text: string; kind: 'excerpt' | 'note' | null }[] {
  if (!ranges.length) return [{ text: content, kind: null }]
  // sort + clip + merge overlaps (note wins over excerpt on ties)
  const sorted = [...ranges]
    .filter((r) => r.end > r.start && r.start >= 0 && r.end <= content.length)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: { start: number; end: number; kind: 'excerpt' | 'note' }[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start < last.end) {
      // overlap: extend + prefer 'note'
      last.end = Math.max(last.end, r.end)
      if (r.kind === 'note') last.kind = 'note'
    } else {
      merged.push({ ...r })
    }
  }
  const segments: { text: string; kind: 'excerpt' | 'note' | null }[] = []
  let cursor = 0
  for (const m of merged) {
    if (m.start > cursor) segments.push({ text: content.slice(cursor, m.start), kind: null })
    segments.push({ text: content.slice(m.start, m.end), kind: m.kind })
    cursor = m.end
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), kind: null })
  return segments.filter((s) => s.text.length > 0)
}

/**
 * Resolve the current DOM Selection (within `containerEl`) to UTF-16 offsets
 * against the rendered plain text. Returns null when the selection is empty or
 * outside the container.
 *
 * Algorithm: walk the container's text nodes in document order, accumulating
 * code-unit lengths, and locate the anchor + focus offsets. The rendered DOM is
 * a known sequence of text nodes (no nested formatting inside TextBlock), so a
 * linear walk yields exact offsets.
 */
export function getOffsetsFromSelection(
  containerEl: HTMLElement | null,
): ResolvedSelection | null {
  if (!containerEl) return null
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!containerEl.contains(range.commonAncestorContainer)) return null

  const textNodes: Text[] = []
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    textNodes.push(node)
    node = walker.nextNode() as Text | null
  }
  if (textNodes.length === 0) return null

  const fullText = textNodes.map((n) => n.nodeValue ?? '').join('')
  let start = -1
  let end = -1
  let offset = 0
  for (const tn of textNodes) {
    const len = tn.nodeValue?.length ?? 0
    if (start < 0 && tn === range.startContainer) {
      start = offset + Math.min(range.startOffset, len)
    }
    if (end < 0 && tn === range.endContainer) {
      end = offset + Math.min(range.endOffset, len)
    }
    offset += len
  }
  // Fallback: if the browser anchored on an element (not a text node), resolve
  // via compareDocumentPosition against the text nodes.
  if (start < 0 || end < 0) {
    const resolved = resolveViaBoundary(range, textNodes, fullText)
    if (!resolved) return null
    start = resolved.start
    end = resolved.end
  }
  if (start === end) return null
  if (start > end) [start, end] = [end, start]
  return { start, end, text: fullText.slice(start, end) }
}

/** Boundary fallback for element-anchored selections (Safari / triple-click). */
function resolveViaBoundary(
  range: Range,
  textNodes: Text[],
  fullText: string,
): { start: number; end: number } | null {
  let start = -1
  let end = -1
  let offset = 0
  for (const tn of textNodes) {
    const len = tn.nodeValue?.length ?? 0
    if (start < 0) {
      const cmp = tn.compareDocumentPosition(range.startContainer)
      // tn is before startContainer → range starts after this node
      if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) start = offset + len
      else if (tn === range.startContainer || cmp & Node.DOCUMENT_POSITION_CONTAINED_BY) {
        start = offset
      }
    }
    if (end < 0) {
      const cmp = tn.compareDocumentPosition(range.endContainer)
      if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) end = offset + len
      else if (tn === range.endContainer || cmp & Node.DOCUMENT_POSITION_CONTAINED_BY) {
        end = offset + len
      }
    }
    offset += len
  }
  if (start < 0 || end < 0) return null
  void fullText
  return { start, end }
}

export function TextBlock({ content, ranges, containerRef }: TextBlockProps) {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const segments = useMemo(() => buildSegments(content, ranges ?? []), [content, ranges])
  return (
    <div
      ref={(el: HTMLDivElement | null) => {
        innerRef.current = el
        if (containerRef) containerRef.current = el
      }}
      className="textblock"
      data-textblock-root
    >
      {segments.map((seg, i) =>
        seg.kind ? (
          <mark
            key={i}
            className={seg.kind === 'note' ? 'textblock__mark textblock__mark--note' : 'textblock__mark'}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </div>
  )
}
