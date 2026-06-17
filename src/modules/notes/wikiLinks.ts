/**
 * Wiki-link [[ ]] parsing and resolution pure functions (NOTE-02 core).
 *
 * This is the renderer-side canonical copy of the wiki-link logic. It exists
 * here (not in electron/services/notes.ts) so the pure functions are unit-
 * testable without better-sqlite3 (which cannot load under vitest/node ABI
 * mismatch.
 *
 * The service (electron/services/notes.ts) mirrors these implementations.
 * Keep them in sync.
 *
 * Syntax supported (06-notes.md §7.2):
 *  - [[target]]        → rawTarget = "target", displayText = "target"
 *  - [[type:id]]       → rawTarget = "type:id", displayText = "type:id"
 *  - [[a|alias]]       → rawTarget = "a", displayText = "alias"
 *  - [[type:id|alias]] → rawTarget = "type:id", displayText = "alias"
 *
 * Unclosed [[ (no matching ]]) is ignored — does not block note saving.
 */

/** Matches [[...]] where inner content has no nested brackets. */
// eslint-disable-next-line no-useless-escape
export const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g

export type LinkTargetType = 'chapter' | 'paragraph' | 'term' | 'note'

export interface ParsedLink {
  /** Raw target text inside [[ ]] before pipe split, trimmed. */
  rawTarget: string
  /** Display text: pipe alias if present, else rawTarget. */
  displayText: string
  /** Character offset of the [[ in the source string. */
  offset: number
}

/**
 * Parse all [[...]] wiki-links from Markdown content into ParsedLink[].
 *
 * Pure function — no DB, no side effects.
 */
export function parseWikiLinks(content: string): ParsedLink[] {
  if (!content) return []
  const results: ParsedLink[] = []
  const re = new RegExp(WIKILINK_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const inner = m[1]!.trim()
    if (inner === '') continue
    const pipeIdx = inner.indexOf('|')
    let rawTarget: string
    let displayText: string
    if (pipeIdx >= 0) {
      rawTarget = inner.slice(0, pipeIdx).trim()
      displayText = inner.slice(pipeIdx + 1).trim() || rawTarget
    } else {
      rawTarget = inner
      displayText = inner
    }
    results.push({
      rawTarget,
      displayText,
      offset: m.index,
    })
  }
  return results
}

/**
 * Normalize a raw term string into a canonical key for the term fallback path.
 * Used when resolveTarget fails: the raw text is stored as a term-type link
 * with this normalized key, so creating a dictionary term later auto-restores
 * the backlink (06-notes.md §7.2).
 */
export function normalizeTermKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Check if a string looks like a UUID (v4 or otherwise). */
export function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim())
}

/** Parse a precise [[type:id]] syntax. Returns null if not precise syntax. */
export function parsePreciseTarget(rawTarget: string): { type: LinkTargetType; id: string } | null {
  const m = rawTarget.match(/^(chapter|paragraph|term|note):(.+)$/i)
  if (!m) return null
  return {
    type: m[1]!.toLowerCase() as LinkTargetType,
    id: m[2]!.trim(),
  }
}

/**
 * DB lookup interface — injected into resolveTarget so the priority cascade can
 * be unit-tested with a mock without needing a real database connection.
 */
export interface TargetLookup {
  entityExists(type: LinkTargetType, id: string): boolean
  findParagraphByTitleLike(text: string): string | null
  findChapterByTitleLike(text: string): string | null
  findNoteByTitleLike(text: string): string | null
  findTermByTerm(text: string): string | null
}

export interface ResolvedLink {
  targetType: LinkTargetType
  targetId: string
  valid: boolean
}

/**
 * Resolve a raw wiki-link target to { targetType, targetId, valid }.
 *
 * Priority cascade (06-notes.md §7.2):
 *  (a) Precise type:id syntax: [[paragraph:uuid]] etc. — if entity exists, match.
 *      If entity doesn't exist, return invalid (keeps type/id for visibility).
 *  (b) Bare UUID (no prefix): try paragraph first, then chapter.
 *  (c) Paragraph title/text fuzzy (paragraphs.text LIKE or chapter title LIKE).
 *  (d) Chapter title fuzzy.
 *  (e) Note title fuzzy.
 *  (f) Term exact match.
 *  (g) All miss → null (caller falls back to term: normalizeTermKey(raw)).
 *
 * This function takes a lookup callback so it is unit-testable without a DB.
 */
export function resolveTarget(rawTarget: string, lookup: TargetLookup): ResolvedLink | null {
  // (a) Precise syntax: [[type:id]]
  const precise = parsePreciseTarget(rawTarget)
  if (precise) {
    if (lookup.entityExists(precise.type, precise.id)) {
      return { targetType: precise.type, targetId: precise.id, valid: true }
    }
    // Precise but entity doesn't exist — keep type/id for invalid link display.
    return { targetType: precise.type, targetId: precise.id, valid: false }
  }

  // (b) Bare UUID
  if (looksLikeUuid(rawTarget)) {
    if (lookup.entityExists('paragraph', rawTarget)) {
      return { targetType: 'paragraph', targetId: rawTarget, valid: true }
    }
    if (lookup.entityExists('chapter', rawTarget)) {
      return { targetType: 'chapter', targetId: rawTarget, valid: true }
    }
  }

  // (c) Paragraph title/text fuzzy
  const paraId = lookup.findParagraphByTitleLike(rawTarget)
  if (paraId) {
    return { targetType: 'paragraph', targetId: paraId, valid: true }
  }

  // (d) Chapter title fuzzy
  const chapId = lookup.findChapterByTitleLike(rawTarget)
  if (chapId) {
    return { targetType: 'chapter', targetId: chapId, valid: true }
  }

  // (e) Note title fuzzy
  const noteId = lookup.findNoteByTitleLike(rawTarget)
  if (noteId) {
    return { targetType: 'note', targetId: noteId, valid: true }
  }

  // (f) Term exact
  const termId = lookup.findTermByTerm(rawTarget)
  if (termId) {
    return { targetType: 'term', targetId: termId, valid: true }
  }

  // (g) All miss → null (caller stores term fallback)
  return null
}

// ---------------------------------------------------------------------------
// Renderer-side segment splitting for preview rendering
// ---------------------------------------------------------------------------

export interface RenderSegment {
  text: string
  /** true when this segment is a wiki-link target. */
  isWikiLink: boolean
  /** Display text for the link (alias or raw target). */
  displayText?: string
  /** Raw target for navigation. */
  rawTarget?: string
}

/**
 * Split Markdown into plain-text and wiki-link segments for rendering.
 * Wiki-link syntax: [[target]], [[type:id]], [[target|alias]].
 */
export function splitWikiLinks(md: string): RenderSegment[] {
  if (!md) return []
  const segments: RenderSegment[] = []
  const re = new RegExp(WIKILINK_RE.source, 'g')
  let lastIndex = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(md)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ text: md.slice(lastIndex, m.index), isWikiLink: false })
    }
    const inner = m[1]!.trim()
    const pipeIdx = inner.indexOf('|')
    const rawTarget = pipeIdx >= 0 ? inner.slice(0, pipeIdx).trim() : inner
    const displayText = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() || rawTarget : inner
    segments.push({
      text: m[0],
      isWikiLink: true,
      displayText,
      rawTarget,
    })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < md.length) {
    segments.push({ text: md.slice(lastIndex), isWikiLink: false })
  }
  return segments
}
