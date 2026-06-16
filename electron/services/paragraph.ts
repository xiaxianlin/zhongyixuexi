/**
 * Paragraph splitting (IMP-02).
 *
 * `splitParagraphs` is a PURE function: given a chapter's XHTML string it
 * returns an ordered list of ParagraphDrafts (plain text, whitespace
 * normalised, long paragraphs split on sentence-ending punctuation, obvious
 * noise flagged). No I/O, no DB — so it is unit-testable in isolation.
 *
 * Strategy (docs/dev/01-import-parse.md §7.1.1):
 *   1. Strip script/style/nav/header/footer, keep block-level element borders.
 *   2. Walk the DOM collecting raw blocks from <p> <h1-6> <li> <blockquote> <div>.
 *   3. Normalise whitespace (trim, collapse runs, fold full-width spaces).
 *   4. Drop empty blocks.
 *   5. Split overlong blocks (> MAX_PARAGRAPH_CHARS) on 。！？；… without cutting
 *      sentences; each sub-paragraph inherits the parent block type.
 *   6. Heuristic noise flag: page numbers, header/footer patterns, too-short
 *      non-CJK fragments.
 */

import { XMLParser } from 'fast-xml-parser'

export interface ParagraphDraft {
  text: string
  /** True when this block looks like header/footer/page-number noise. */
  isNoise: boolean
}

/** Paragraphs longer than this (in characters) are split on sentence punctuation. */
export const MAX_PARAGRAPH_CHARS = 300

/**
 * Sentence-ending CJK + ASCII punctuation. The trailing punctuation is kept
 * attached to the sentence it terminates (no sentence is left headless).
 */
const SENTENCE_END = /[。！？；…!?]/

/** Tags whose entire subtree is non-content and must be removed before walking. */
const DROP_TAGS = new Set([
  'script',
  'style',
  'nav',
  'header',
  'footer',
  'head',
  'link',
  'meta',
  'title',
])

/** Block-level elements that each seed one or more paragraph candidates. */
const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'div',
  'section',
  'article',
  'td',
  'th',
  'dd',
  'dt',
])

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // preserve order so we can walk the tree top-down
  preserveOrder: true,
})

interface OrderedNode {
  '#text'?: string
  '?xml'?: string
  [key: string]: unknown
}

/**
 * Collapses all whitespace runs to a single ASCII space and folds full-width
 * spaces / non-breaking spaces (IMP-05 whitespace normalisation).
 * Uses explicit escapes so the source contains no literal irregular whitespace.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/[\u3000\u00A0\u200B\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True if the fragment contains at least one CJK ideograph. */
function containsCjk(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text)
}

/**
 * Heuristic: is this short fragment likely header/footer/page-number noise?
 * - Pure page numbers like "12", "第 12 页", "- 3 -".
 * - Too short (<2 chars) AND no CJK.
 * - Common watermark tokens.
 */
function isNoiseText(text: string): boolean {
  const t = text.trim()
  if (t === '') return true
  // pure arabic number / page-number patterns
  if (/^[\d\s\-—–.,]+$/.test(t)) return true
  if (/^第\s*\d+\s*页$/.test(t)) return true
  if (/^[-—–]\s*\d+\s*[-—–]$/.test(t)) return true
  // watermarks / trial markers
  if (/(试读|扫描版|仅供预览|www\.|https?:\/\/|版权所有|摘自)/.test(t)) return true
  // too short and no CJK content
  if (t.length < 2 && !containsCjk(t)) return true
  return false
}

/**
 * Splits a normalised string on sentence-ending punctuation without cutting
 * sentences. Natural paragraphs shorter than the cap are kept whole; only
 * blocks exceeding MAX_PARAGRAPH_CHARS are broken at a sentence boundary.
 * A long block with NO sentence punctuation is returned whole (we never split
 * mid-word/mid-sentence).
 */
function splitBySentence(text: string): string[] {
  if (text.length <= MAX_PARAGRAPH_CHARS) return [text]
  const out: string[] = []
  let buf = ''
  for (const ch of text) {
    buf += ch
    if (SENTENCE_END.test(ch) && buf.length > MAX_PARAGRAPH_CHARS) {
      const candidate = buf.trim()
      if (candidate) {
        out.push(candidate)
        buf = ''
      }
    }
  }
  const tail = buf.trim()
  if (tail) out.push(tail)

  // merge any tiny trailing fragments back into the previous piece so we don't
  // emit degenerate 1-2 char shards when the cap splits inside a long run
  const merged: string[] = []
  for (const piece of out) {
    if (piece.length === 0) continue
    const last = merged[merged.length - 1]
    if (last !== undefined && piece.length < 4 && !SENTENCE_END.test(piece)) {
      merged[merged.length - 1] = last + piece
    } else {
      merged.push(piece)
    }
  }
  // if nothing split (no sentence punctuation anywhere), keep the whole block
  return merged.length > 0 ? merged : [text]
}

/**
 * Walks the ordered DOM, collecting block-level text fragments in document
 * order. `<br>` is treated as a soft break (newline) so natural paragraphs
 * crammed into one `<p>` via `<br>` can still be separated.
 */
function collectBlocks(ordered: OrderedNode[]): string[] {
  const blocks: string[] = []

  const walk = (nodes: OrderedNode[]): string => {
    let acc = ''
    for (const node of nodes) {
      if (typeof node === 'string') {
        acc += node
        continue
      }
      for (const key of Object.keys(node)) {
        if (key === '#text') {
          acc += node['#text'] ?? ''
          continue
        }
        if (key === '?xml') continue
        if (DROP_TAGS.has(key)) continue
        const childRaw = node[key]
        const children = Array.isArray(childRaw) ? (childRaw as OrderedNode[]) : []

        if (key === 'br') {
          // soft break → flush current accumulator as its own block boundary
          if (acc.trim()) {
            blocks.push(acc)
            acc = ''
          }
          continue
        }

        if (BLOCK_TAGS.has(key)) {
          // flush any inline text accumulated before this block
          if (acc.trim()) {
            blocks.push(acc)
            acc = ''
          }
          // recurse into the block; its own children may contain nested blocks
          const inner = walk(children)
          if (inner.trim()) blocks.push(inner)
        } else {
          // inline element (span/em/strong/a/…) → keep concatenating
          acc += walk(children)
        }
      }
    }
    return acc
  }

  const tail = walk(ordered)
  if (tail.trim()) blocks.push(tail)
  return blocks
}

/**
 * Splits a chapter XHTML string into ordered ParagraphDrafts.
 *
 * @param input chapter XHTML (full document or body fragment)
 * @returns ordered paragraphs; empty segments are dropped, noise flagged.
 */
export function splitParagraphs(input: string): ParagraphDraft[] {
  if (!input || !input.trim()) return []

  let ordered: OrderedNode[]
  try {
    ordered = parser.parse(input) as OrderedNode[]
  } catch {
    // malformed XHTML → fall back to a tag-strip + newline split so we never
    // lose an entire chapter; the review workbench can still surface it.
    const stripped = input
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
    return fromLines(stripped.split('\n'))
  }

  const rawBlocks = collectBlocks(ordered)
  const drafts: ParagraphDraft[] = []

  for (const raw of rawBlocks) {
    const text = normalizeWhitespace(raw)
    if (text === '') continue
    for (const piece of splitBySentence(text)) {
      const clean = normalizeWhitespace(piece)
      if (clean === '') continue
      drafts.push({ text: clean, isNoise: isNoiseText(clean) })
    }
  }

  return drafts
}

/** Builds drafts from pre-split lines (used by the malformed-XHTML fallback). */
function fromLines(lines: string[]): ParagraphDraft[] {
  const drafts: ParagraphDraft[] = []
  for (const line of lines) {
    const text = normalizeWhitespace(line)
    if (text === '') continue
    for (const piece of splitBySentence(text)) {
      const clean = normalizeWhitespace(piece)
      if (clean === '') continue
      drafts.push({ text: clean, isNoise: isNoiseText(clean) })
    }
  }
  return drafts
}
