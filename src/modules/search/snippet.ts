/**
 * Parse an FTS5 / LIKE snippet containing <mark>…</mark> markers into an array
 * of plain / highlighted segments so React can render them as nodes WITHOUT
 * dangerouslySetInnerHTML (05-search.md §4.1.3 / §10.3). The snippet body text
 * itself is never HTML-escaped by snippet()/LIKE, but we treat the <mark> tags
 * as the only markup and pass everything else through as text — so a snippet
 * containing literal `<` from source text is shown verbatim (React escapes
 * text-node children automatically), which is the safe default.
 *
 * Pure; exported for unit testing.
 */

export interface SnippetSegment {
  text: string
  mark: boolean
}

const MARK_RE = /<mark>([\s\S]*?)<\/mark>/

/**
 * Split `snippet` into segments. Only `<mark>…</mark>` is recognized as
 * markup; any stray `<` / `>` outside a mark becomes ordinary text.
 */
export function parseSnippet(snippet: string): SnippetSegment[] {
  if (!snippet) return []
  const out: SnippetSegment[] = []
  let rest = snippet
  while (rest.length > 0) {
    const m = MARK_RE.exec(rest)
    if (!m) {
      out.push({ text: rest, mark: false })
      break
    }
    if (m.index > 0) {
      out.push({ text: rest.slice(0, m.index), mark: false })
    }
    out.push({ text: m[1], mark: true })
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}
