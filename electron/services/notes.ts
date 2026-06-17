/**
 * Notes service (NOTE module).
 *
 * Markdown note CRUD, wiki-link [[ ]] parsing + backlinks, tags/notebooks
 * organization, and export (MD/HTML/PDF). All queries go through the
 * better-sqlite3 singleton from getDb(); the connection initializer enforces
 * PRAGMA foreign_keys=ON (00-arch §5.1) so the ON DELETE CASCADE / SET NULL
 * declared in migrations/notes.sql actually fires.
 *
 * Wiki-link parsing (NOTE-02 core) is split into pure functions
 * (parseWikiLinks, normalizeTermKey) that are unit-tested without a database,
 * and a DB-dependent resolver (resolveTarget) that takes a lookup callback so
 * the priority cascade can also be tested in isolation.
 *
 * PDF export (NOTE-04) uses Electron's built-in Chromium via BrowserWindow
 * to avoid bundling puppeteer. The service returns assembled HTML; the IPC
 * layer (which has access to the Electron app/BrowserWindow APIs) handles
 * the actual printToPDF call.
 */
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { getDb } from '../db/connection'
import { AppError } from '../lib/error'
import { ACTIVE_ANALYSIS_JOIN, ACTIVE_ANALYSIS_SELECT } from './paragraph-analysis'

// ===========================================================================
// DTOs (self-contained; renderer mirrors in src/modules/notes/types.ts)
// ===========================================================================

export interface Note {
  id: string
  title: string
  content: string // Markdown source (only storage)
  book_id: string | null
  chapter_id: string | null
  paragraph_id: string | null
  notebook_id: string | null
  word_count: number
  pinned: boolean
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export type LinkTargetType = 'chapter' | 'paragraph' | 'term' | 'note'

export interface NoteLink {
  id: string
  source_note_id: string
  target_type: LinkTargetType
  target_id: string
  target_alias: string | null
  display_text: string | null
  position: number
  /** JOIN-supplemented (not a table column). */
  target_title?: string
  target_valid?: boolean
}

export interface Backlink extends NoteLink {
  note_title: string
  note_updated_at: number
}

export interface NoteSearchHit {
  note_id: string
  title: string
  snippet: string
  rank: number
}

export interface NoteListItem {
  id: string
  title: string
  preview: string
  notebook_id: string | null
  paragraph_id: string | null
  pinned: boolean
  updated_at: number
}

export interface ParagraphNoteCard {
  id: string
  content: string
  pinned: boolean
  created_at: number
  updated_at: number
}

export interface NoteListResult {
  items: NoteListItem[]
  total: number
}

export interface Tag {
  id: string
  name: string
  color: string | null
  created_at: number
}

export interface Notebook {
  id: string
  name: string
  parent_id: string | null
  sort_order: number
  icon: string | null
  created_at: number
  updated_at: number
}

export interface NotebookNode extends Notebook {
  children: NotebookNode[]
}

export interface CreateNoteInput {
  title?: string
  content?: string
  book_id?: string | null
  chapter_id?: string | null
  paragraph_id?: string | null
  notebook_id?: string | null
}

export interface UpdateNoteInput {
  id: string
  title?: string
  content?: string
  paragraph_id?: string | null
  notebook_id?: string | null
  pinned?: boolean
}

export interface ExportInput {
  note_ids: string[]
  format: 'md' | 'html' | 'pdf'
  out_dir: string
  bundle?: boolean
}

export interface ExportResult {
  files: string[]
}

export interface ExportParagraphInput {
  paragraph_id: string
  include: {
    original?: boolean
    modern?: boolean
    image?: boolean
    notes?: boolean
  }
  format: 'md' | 'html' | 'pdf'
  out_dir: string
}

// ===========================================================================
// Pure wiki-link parsing (NOTE-02 core)
// ---------------------------------------------------------------------------
// These functions are MIRRORED in src/modules/notes/wikiLinks.ts (renderer-side
// canonical copy) for unit testing — electron/services/notes.ts imports
// better-sqlite3 + electron at the top level, which cannot load under vitest/
// node (ABI mismatch). Keep these in sync with src/modules/notes/wikiLinks.ts.
// Same pattern as src/modules/learning/sm2.ts ↔ electron/services/learning.ts.
// ===========================================================================

/** Matches [[...]] where inner content has no nested brackets. */
// eslint-disable-next-line no-useless-escape
export const WIKILINK_RE = /\[\[([^\[\]]+)\]\]/g

export interface ParsedLink {
  /** Raw target text inside [[ ]] before pipe split, trimmed. */
  rawTarget: string
  /** Display text: pipe alias if present, else rawTarget. */
  displayText: string
  /** Character offset of the [[ in the source string (for highlight positioning). */
  offset: number
}

/**
 * Parse all [[...]] wiki-links from Markdown content into ParsedLink[].
 *
 * Syntax supported (06-notes.md §7.2):
 *  - [[target]]        → rawTarget = "target", displayText = "target"
 *  - [[type:id]]       → rawTarget = "type:id", displayText = "type:id"
 *  - [[a|alias]]       → rawTarget = "a", displayText = "alias"
 *  - [[type:id|alias]] → rawTarget = "type:id", displayText = "alias"
 *
 * Unclosed [[ (no matching ]]) is NOT matched by the regex — it is silently
 * ignored and does not block note saving.
 *
 * Pure function — no DB, no side effects. Exported for unit testing.
 */
export function parseWikiLinks(content: string): ParsedLink[] {
  if (!content) return []
  const results: ParsedLink[] = []
  // Use a fresh regex (global flag reuses lastIndex on shared instances).
  const re = new RegExp(WIKILINK_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const inner = m[1].trim()
    if (inner === '') continue
    // Pipe split: only split on the FIRST pipe; display text may contain pipes? No —
    // standard wiki-link syntax uses single pipe; we take everything after first | as alias.
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
 *
 * Pure function — exported for unit testing.
 */
export function normalizeTermKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Check if a string looks like a UUID (v4 or otherwise). Pure — exported for testing. */
export function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim())
}

/** Parse a precise [[type:id]] syntax. Returns null if not precise syntax. Pure. */
export function parsePreciseTarget(rawTarget: string): { type: LinkTargetType; id: string } | null {
  const m = rawTarget.match(/^(chapter|paragraph|term|note):(.+)$/i)
  if (!m) return null
  return {
    type: m[1].toLowerCase() as LinkTargetType,
    id: m[2].trim(),
  }
}

// ===========================================================================
// Resolved link (after DB lookup)
// ===========================================================================

export interface ResolvedLink {
  targetType: LinkTargetType
  targetId: string
  valid: boolean
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

/**
 * Resolve a raw wiki-link target to { targetType, targetId, valid }.
 *
 * Priority cascade (06-notes.md §7.2):
 *  (a) Precise type:id syntax: [[paragraph:uuid]] etc. — if entity exists, exact match.
 *  (b) Bare UUID (no prefix): try paragraph first, then chapter.
 *  (c) Paragraph title fuzzy (paragraphs.text LIKE or chapter title LIKE).
 *  (d) Chapter title fuzzy.
 *  (e) Note title fuzzy.
 *  (f) Term exact match.
 *  (g) All miss → return null (caller falls back to term: normalizeTermKey(raw)).
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
    // Precise but entity doesn't exist — don't fall through to fuzzy, keep type
    // so the invalid link is visible. Caller stores it as-is (term fallback for unknown).
    // Actually: fall through to fuzzy below — the user might have a precise-ish but
    // slightly wrong id. But 06-notes.md says if precise, don't fuzzy. So return invalid.
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

/**
 * Build a concrete TargetLookup from the database. Used by reparseLinks.
 */
function makeDbLookup(): TargetLookup {
  const db = getDb()
  return {
    entityExists(type, id) {
      const table =
        type === 'chapter'
          ? 'chapters'
          : type === 'paragraph'
            ? 'paragraphs'
            : type === 'note'
              ? 'notes'
              : 'dictionary_terms'
      const col = type === 'term' ? 'term_id' : 'id'
      const extra = type === 'note' ? ' AND deleted_at IS NULL' : ''
      const row = db.prepare(`SELECT 1 FROM ${table} WHERE ${col} = ?${extra} LIMIT 1`).get(id)
      return !!row
    },
    findParagraphByTitleLike(text) {
      const row = db
        .prepare(
          `SELECT p.id FROM paragraphs p
           JOIN chapters c ON p.chapter_id = c.id
           WHERE p.deleted_at IS NULL AND (p.text LIKE ? OR c.title LIKE ?)
           LIMIT 1`,
        )
        .get(`%${text}%`, `%${text}%`) as { id: string } | undefined
      return row?.id ?? null
    },
    findChapterByTitleLike(text) {
      const row = db
        .prepare(`SELECT id FROM chapters WHERE deleted_at IS NULL AND title LIKE ? LIMIT 1`)
        .get(`%${text}%`) as { id: string } | undefined
      return row?.id ?? null
    },
    findNoteByTitleLike(text) {
      const row = db
        .prepare(
          `SELECT id FROM notes WHERE deleted_at IS NULL AND title LIKE ? LIMIT 1`,
        )
        .get(`%${text}%`) as { id: string } | undefined
      return row?.id ?? null
    },
    findTermByTerm(text) {
      const row = db
        .prepare('SELECT term_id FROM dictionary_terms WHERE term = ? LIMIT 1')
        .get(text) as { term_id: string } | undefined
      return row?.term_id ?? null
    },
  }
}

/**
 * Re-compute all out-links for a note. Called inside the save transaction:
 * deletes all old note_links for this note, parses content, resolves each
 * link, and inserts fresh rows. Deduplicates by (targetType, targetId) but
 * keeps position as the first occurrence index (06-notes.md §7.2).
 *
 * Failed resolutions fall back to type 'term' with target_id = normalized key,
 * so future dictionary creation auto-restores the backlink.
 */
export function reparseLinks(noteId: string, content: string): void {
  const db = getDb()
  const lookup = makeDbLookup()
  const parsed = parseWikiLinks(content)
  const now = Date.now()

  const insert = db.prepare(
    `INSERT INTO note_links (id, source_note_id, target_type, target_id, target_alias, display_text, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const seen = new Set<string>()
  let position = 0

  for (const link of parsed) {
    const resolved = resolveTarget(link.rawTarget, lookup)
    let targetType: LinkTargetType
    let targetId: string

    if (resolved && resolved.valid) {
      targetType = resolved.targetType
      targetId = resolved.targetId
    } else if (resolved && !resolved.valid) {
      // Precise type:id but entity doesn't exist — keep the type/id as-is
      // so the invalid link is visible in the outlinks panel.
      targetType = resolved.targetType
      targetId = resolved.targetId
    } else {
      // Total miss → term fallback (06-notes.md §7.2)
      targetType = 'term'
      targetId = normalizeTermKey(link.rawTarget)
    }

    const dedupKey = `${targetType}:${targetId}`
    if (seen.has(dedupKey)) {
      position++
      continue
    }
    seen.add(dedupKey)

    insert.run(
      randomUUID(),
      noteId,
      targetType,
      targetId,
      link.rawTarget,
      link.displayText,
      position,
      now,
    )
    position++
  }
}

// ===========================================================================
// CRUD (NOTE-01 / NOTE-05)
// ===========================================================================

const NOTE_COLS = `
  id, title, content, book_id, chapter_id, paragraph_id, notebook_id,
  word_count, pinned, created_at, updated_at, deleted_at`

function rowToNote(r: unknown): Note {
  const row = r as Record<string, unknown>
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    book_id: (row.book_id as string) ?? null,
    chapter_id: (row.chapter_id as string) ?? null,
    paragraph_id: (row.paragraph_id as string) ?? null,
    notebook_id: (row.notebook_id as string) ?? null,
    word_count: row.word_count as number,
    pinned: Boolean(row.pinned),
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    deleted_at: (row.deleted_at as number) ?? null,
  }
}

function countWords(md: string): number {
  // Approximate "words": count CJK characters + latin word tokens.
  const cjk = (md.match(/[一-鿿㐀-䶿]/g) || []).length
  const latin = (md.match(/[a-zA-Z0-9]+/g) || []).length
  return cjk + latin
}

/**
 * Backfill chapter_id / book_id from a paragraph_id (06-notes.md §7.6).
 * If paragraph doesn't exist (e.g. already deleted), leaves them null.
 */
function backfillFromParagraph(
  paragraphId: string,
): { chapter_id: string | null; book_id: string | null } {
  const db = getDb()
  const para = db
    .prepare('SELECT chapter_id FROM paragraphs WHERE id = ? AND deleted_at IS NULL')
    .get(paragraphId) as { chapter_id: string } | undefined
  if (!para) return { chapter_id: null, book_id: null }
  const chap = db
    .prepare('SELECT book_id FROM chapters WHERE id = ? AND deleted_at IS NULL')
    .get(para.chapter_id) as { book_id: string } | undefined
  return {
    chapter_id: para.chapter_id,
    book_id: chap?.book_id ?? null,
  }
}

export function createNote(input: CreateNoteInput): Note {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  const title = input.title?.trim() || '无标题笔记'
  const content = input.content ?? ''
  const wordCount = countWords(content)

  let bookId = input.book_id ?? null
  let chapterId = input.chapter_id ?? null
  const paragraphId = input.paragraph_id ?? null

  // Backfill chapter/book from paragraph if paragraph_id is given.
  if (paragraphId) {
    const filled = backfillFromParagraph(paragraphId)
    chapterId = filled.chapter_id ?? chapterId
    bookId = filled.book_id ?? bookId
  }

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO notes (id, title, content, book_id, chapter_id, paragraph_id, notebook_id, word_count, pinned, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
    ).run(
      id,
      title,
      content,
      bookId,
      chapterId,
      paragraphId,
      input.notebook_id ?? null,
      wordCount,
      now,
      now,
    )
    // Parse wiki-links for the initial content.
    reparseLinks(id, content)
  })
  tx()

  const row = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(id)
  return rowToNote(row)
}

export function getNote(id: string): Note | null {
  const db = getDb()
  const row = db
    .prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ? AND deleted_at IS NULL`)
    .get(id)
  return row ? rowToNote(row) : null
}

export function updateNote(input: UpdateNoteInput): Note {
  const db = getDb()
  const existing = db
    .prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ? AND deleted_at IS NULL`)
    .get(input.id)
  if (!existing) {
    throw new AppError('NOT_FOUND', `笔记 ${input.id} 不存在`)
  }
  const note = rowToNote(existing)
  const now = Date.now()

  const title = input.title != null ? input.title.trim() || '无标题笔记' : note.title
  const content = input.content != null ? input.content : note.content
  const contentChanged = input.content != null && input.content !== note.content
  const wordCount = contentChanged ? countWords(content) : note.word_count
  const pinned =
    input.pinned != null ? (input.pinned ? 1 : 0) : note.pinned ? 1 : 0

  let paragraphId = note.paragraph_id
  let chapterId = note.chapter_id
  let bookId = note.book_id
  const notebookId = input.notebook_id != null ? input.notebook_id : note.notebook_id

  if (input.paragraph_id !== undefined) {
    paragraphId = input.paragraph_id
    if (paragraphId) {
      const filled = backfillFromParagraph(paragraphId)
      chapterId = filled.chapter_id
      bookId = filled.book_id
    } else {
      // Explicitly unbinding paragraph: keep book/chapter for the note
      chapterId = note.chapter_id
      bookId = note.book_id
    }
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE notes
       SET title = ?, content = ?, word_count = ?, paragraph_id = ?, chapter_id = ?, book_id = ?,
           notebook_id = ?, pinned = ?, updated_at = ?
       WHERE id = ?`,
    ).run(title, content, wordCount, paragraphId, chapterId, bookId, notebookId, pinned, now, input.id)

    // Re-parse wiki-links only if content changed.
    if (contentChanged) {
      reparseLinks(input.id, content)
    }
  })
  tx()

  const row = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(input.id)
  return rowToNote(row)
}

export function deleteNote(id: string): { ok: true } {
  const db = getDb()
  const now = Date.now()
  const res = db
    .prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(now, now, id)
  if (res.changes === 0) {
    throw new AppError('NOT_FOUND', `笔记 ${id} 不存在或已删除`)
  }
  return { ok: true }
}

/**
 * NOTE-05: paragraph note cards for the current reading/detail UI.
 * Returns full content for the side drawer / reading sidebar stream; generic
 * library note lists still use NoteListItem with title + preview.
 */
export function getNotesByParagraph(paragraphId: string): ParagraphNoteCard[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, content, pinned, created_at, updated_at
       FROM notes
       WHERE paragraph_id = ? AND deleted_at IS NULL
       ORDER BY pinned DESC, updated_at DESC`,
    )
    .all(paragraphId) as Array<{
    id: string
    content: string
    pinned: number
    created_at: number
    updated_at: number
  }>
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    pinned: Boolean(r.pinned),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))
}

export function getNotesByChapter(chapterId: string): NoteListItem[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, title, substr(content, 1, 200) AS preview, notebook_id, paragraph_id,
              pinned, updated_at
       FROM notes
       WHERE chapter_id = ? AND deleted_at IS NULL
       ORDER BY pinned DESC, updated_at DESC`,
    )
    .all(chapterId) as Array<{
    id: string
    title: string
    preview: string
    notebook_id: string | null
    paragraph_id: string | null
    pinned: number
    updated_at: number
  }>
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    preview: r.preview,
    notebook_id: r.notebook_id,
    paragraph_id: r.paragraph_id,
    pinned: Boolean(r.pinned),
    updated_at: r.updated_at,
  }))
}

export interface ListFilter {
  notebook_id?: string | null
  tag_ids?: string[]
  book_id?: string | null
  limit?: number
  offset?: number
}

export function listNotes(filter: ListFilter = {}): NoteListResult {
  const db = getDb()
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500))
  const offset = Math.max(0, filter.offset ?? 0)

  const conditions: string[] = ['n.deleted_at IS NULL']
  const params: unknown[] = []

  if (filter.notebook_id) {
    conditions.push('n.notebook_id = ?')
    params.push(filter.notebook_id)
  }
  if (filter.book_id) {
    conditions.push('n.book_id = ?')
    params.push(filter.book_id)
  }
  if (filter.tag_ids && filter.tag_ids.length > 0) {
    const ph = filter.tag_ids.map(() => '?').join(',')
    conditions.push(
      `n.id IN (SELECT ref_id FROM tag_refs WHERE ref_type = 'note' AND tag_id IN (${ph}))`,
    )
    params.push(...filter.tag_ids)
  }

  const where = conditions.join(' AND ')

  const rows = db
    .prepare(
      `SELECT n.id, n.title, substr(n.content, 1, 200) AS preview, n.notebook_id,
              n.paragraph_id, n.pinned, n.updated_at
       FROM notes n
       WHERE ${where}
       ORDER BY n.pinned DESC, n.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<{
    id: string
    title: string
    preview: string
    notebook_id: string | null
    paragraph_id: string | null
    pinned: number
    updated_at: number
  }>

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM notes n WHERE ${where}`)
    .get(...params) as { n: number }

  return {
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      preview: r.preview,
      notebook_id: r.notebook_id,
      paragraph_id: r.paragraph_id,
      pinned: Boolean(r.pinned),
      updated_at: r.updated_at,
    })),
    total: totalRow.n,
  }
}

// ===========================================================================
// Out-links + backlinks (NOTE-02)
// ===========================================================================

export function getOutlinks(noteId: string): NoteLink[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT nl.id, nl.source_note_id, nl.target_type, nl.target_id,
              nl.target_alias, nl.display_text, nl.position
       FROM note_links nl
       WHERE nl.source_note_id = ?
       ORDER BY nl.position`,
    )
    .all(noteId) as Array<Omit<NoteLink, 'target_title' | 'target_valid'>>

  return rows.map((r) => {
    const { title, valid } = resolveTargetTitle(r.target_type, r.target_id)
    return { ...r, target_title: title, target_valid: valid }
  })
}

export function getBacklinks(targetType: LinkTargetType, targetId: string): Backlink[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT nl.id, nl.source_note_id, nl.target_type, nl.target_id,
              nl.target_alias, nl.display_text, nl.position,
              n.title AS note_title, n.updated_at AS note_updated_at
       FROM note_links nl
       JOIN notes n ON n.id = nl.source_note_id
       WHERE nl.target_type = ? AND nl.target_id = ? AND n.deleted_at IS NULL
       ORDER BY n.updated_at DESC`,
    )
    .all(targetType, targetId) as Array<
    Omit<NoteLink, 'target_title' | 'target_valid'> & {
      note_title: string
      note_updated_at: number
    }
  >

  return rows.map((r) => ({
    id: r.id,
    source_note_id: r.source_note_id,
    target_type: r.target_type,
    target_id: r.target_id,
    target_alias: r.target_alias,
    display_text: r.display_text,
    target_title: r.display_text ?? r.target_alias ?? undefined,
    target_valid: true,
    position: r.position,
    note_title: r.note_title,
    note_updated_at: r.note_updated_at,
  }))
}

/**
 * Resolve a target's current title for display in the outlinks/backlinks panel.
 * Also returns valid=false when the target no longer exists (e.g. deleted
 * paragraph), so the renderer can show an "(已删除)" indicator.
 */
function resolveTargetTitle(
  targetType: LinkTargetType,
  targetId: string,
): { title: string; valid: boolean } {
  const db = getDb()
  if (targetType === 'chapter') {
    const row = db
      .prepare('SELECT title FROM chapters WHERE id = ? AND deleted_at IS NULL')
      .get(targetId) as { title: string } | undefined
    return row ? { title: row.title, valid: true } : { title: '(已删除)', valid: false }
  }
  if (targetType === 'paragraph') {
    const row = db
      .prepare(
        `SELECT substr(text, 1, 40) AS text FROM paragraphs WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(targetId) as { text: string } | undefined
    return row ? { title: row.text, valid: true } : { title: '(已删除)', valid: false }
  }
  if (targetType === 'note') {
    const row = db
      .prepare('SELECT title FROM notes WHERE id = ? AND deleted_at IS NULL')
      .get(targetId) as { title: string } | undefined
    return row ? { title: row.title, valid: true } : { title: '(已删除)', valid: false }
  }
  // term
  const row = db
    .prepare('SELECT term FROM dictionary_terms WHERE term_id = ?')
    .get(targetId) as { term: string } | undefined
  return row ? { title: row.term, valid: true } : { title: targetId, valid: false }
}

/**
 * Real-time resolution for editor auto-complete dropdown (06-notes.md §5.2).
 * Given raw input (what the user typed after [[), returns matching candidates
 * or a single resolved target.
 */
export function resolveLinkTarget(raw: string): {
  targetType: LinkTargetType
  targetId: string
  title: string
  valid: boolean
} | null {
  const lookup = makeDbLookup()
  const resolved = resolveTarget(raw, lookup)
  if (!resolved) {
    return null
  }
  const { title, valid } = resolveTargetTitle(resolved.targetType, resolved.targetId)
  return {
    targetType: resolved.targetType,
    targetId: resolved.targetId,
    title,
    valid,
  }
}

// ===========================================================================
// Full-text search (NOTE-03)
// ===========================================================================

export function searchNotes(
  query: string,
  opts: { notebook_id?: string; limit?: number } = {},
): { items: NoteSearchHit[]; total: number } {
  const q = (query ?? '').trim()
  if (q === '') return { items: [], total: 0 }

  const db = getDb()
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200))

  const match = `"${q.replace(/"/g, '""')}"`

  const rows = db
    .prepare(
      `SELECT fts.note_id AS note_id, fts.title AS title,
              snippet(fts_notes, 2, '<mark>', '</mark>', ' … ', 24) AS snippet,
              bm25(fts_notes) AS rank
       FROM fts_notes
       WHERE fts_notes MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(match, limit) as NoteSearchHit[]

  const totalRow = db
    .prepare('SELECT COUNT(*) AS n FROM fts_notes WHERE fts_notes MATCH ?')
    .get(match) as { n: number }

  // Optionally filter by notebook_id (post-filter since FTS can't join notebooks easily).
  let items = rows
  if (opts.notebook_id) {
    const validIds = new Set(
      db
        .prepare('SELECT id FROM notes WHERE notebook_id = ? AND deleted_at IS NULL')
        .all(opts.notebook_id)
        .map((r: unknown) => (r as { id: string }).id),
    )
    items = rows.filter((r) => validIds.has(r.note_id))
  }

  return { items, total: totalRow.n }
}

// ===========================================================================
// Tags (NOTE-03)
// ===========================================================================

export function listTags(refType?: string): Tag[] {
  const db = getDb()
  if (refType) {
    return db
      .prepare(
        `SELECT DISTINCT t.id, t.name, t.color, t.created_at
         FROM tags t
         JOIN tag_refs r ON r.tag_id = t.id
         WHERE r.ref_type = ?
         ORDER BY t.name`,
      )
      .all(refType) as Tag[]
  }
  return db
    .prepare('SELECT id, name, color, created_at FROM tags ORDER BY name')
      .all() as Tag[]
}

export function setTags(refType: string, refId: string, tagIds: string[]): { ok: true } {
  const db = getDb()
  const now = Date.now()

  const tx = db.transaction(() => {
    // Delete all existing tag_refs for this target.
    db.prepare('DELETE FROM tag_refs WHERE ref_type = ? AND ref_id = ?').run(refType, refId)
    // Insert new ones.
    const insert = db.prepare(
      `INSERT OR IGNORE INTO tag_refs (id, tag_id, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    for (const tagId of tagIds) {
      insert.run(randomUUID(), tagId, refType, refId, now)
    }
  })
  tx()

  return { ok: true }
}

/** Get tag ids attached to a specific entity. */
export function getTagsForRef(refType: string, refId: string): Tag[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT t.id, t.name, t.color, t.created_at
       FROM tags t
       JOIN tag_refs r ON r.tag_id = t.id
       WHERE r.ref_type = ? AND r.ref_id = ?
       ORDER BY t.name`,
    )
    .all(refType, refId) as Tag[]
}

/** Create a tag if it doesn't exist (by name), return the Tag. */
export function ensureTag(name: string, color?: string | null): Tag {
  const db = getDb()
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new AppError('VALIDATION', '标签名不能为空')
  }
  const existing = db.prepare('SELECT id, name, color, created_at FROM tags WHERE name = ?').get(trimmed) as
    | Tag
    | undefined
  if (existing) return existing

  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    'INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, trimmed, color ?? null, now)
  return { id, name: trimmed, color: color ?? null, created_at: now }
}

// ===========================================================================
// Notebooks (NOTE-03)
// ===========================================================================

export function listNotebooks(): NotebookNode[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT id, name, parent_id, sort_order, icon, created_at, updated_at
       FROM notebooks
       ORDER BY sort_order, created_at`,
    )
    .all() as Notebook[]
  return buildNotebookTree(rows)
}

/** Pure tree builder for notebooks (mirrors library.ts buildChapterTree pattern). */
export function buildNotebookTree(flat: Notebook[]): NotebookNode[] {
  const map = new Map<string, NotebookNode>()
  const roots: NotebookNode[] = []

  for (const r of flat) {
    map.set(r.id, { ...r, children: [] })
  }
  for (const r of flat) {
    const node = map.get(r.id)!
    const parent = r.parent_id ? map.get(r.parent_id) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

export function createNotebook(name: string, parentId?: string | null): Notebook {
  const db = getDb()
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new AppError('VALIDATION', '笔记本名不能为空')
  }
  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO notebooks (id, name, parent_id, sort_order, icon, created_at, updated_at)
     VALUES (?, ?, ?, 0, NULL, ?, ?)`,
  ).run(id, trimmed, parentId ?? null, now, now)

  return {
    id,
    name: trimmed,
    parent_id: parentId ?? null,
    sort_order: 0,
    icon: null,
    created_at: now,
    updated_at: now,
  }
}

export function renameNotebook(id: string, name: string): Notebook {
  const db = getDb()
  const trimmed = name.trim()
  if (trimmed === '') {
    throw new AppError('VALIDATION', '笔记本名不能为空')
  }
  const now = Date.now()
  const res = db
    .prepare('UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?')
    .run(trimmed, now, id)
  if (res.changes === 0) {
    throw new AppError('NOT_FOUND', `笔记本 ${id} 不存在`)
  }
  const row = db
    .prepare('SELECT id, name, parent_id, sort_order, icon, created_at, updated_at FROM notebooks WHERE id = ?')
    .get(id) as Notebook
  return row
}

export function deleteNotebook(id: string): { ok: true } {
  const db = getDb()
  // notes.notebook_id is ON DELETE SET NULL → notes degrade to ungrouped.
  // notebooks.parent_id is ON DELETE CASCADE → child notebooks cascade-delete.
  const res = db.prepare('DELETE FROM notebooks WHERE id = ?').run(id)
  if (res.changes === 0) {
    throw new AppError('NOT_FOUND', `笔记本 ${id} 不存在`)
  }
  return { ok: true }
}

// ===========================================================================
// Export (NOTE-04)
// ===========================================================================

/**
 * Minimal Markdown → HTML renderer for export. Avoids pulling in markdown-it
 * as a dependency for the first slice; handles headings, bold, italic, code,
 * links, blockquotes, lists, and paragraphs. If richer rendering is needed
 * later, swap this out for markdown-it (06-notes.md §9.1).
 *
 * Pure function — exported for testing.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n')
  const html: string[] = []
  let inList = false
  let inQuote = false

  const closeLists = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
    if (inQuote) {
      html.push('</blockquote>')
      inQuote = false
    }
  }

  const inline = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
        const pipeIdx = inner.indexOf('|')
        const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : inner
        return `<span class="wikilink">${display}</span>`
      })
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line === '') {
      closeLists()
      continue
    }

    // Headings
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      closeLists()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      if (!inQuote) {
        closeLists()
        html.push('<blockquote>')
        inQuote = true
      }
      html.push(`<p>${inline(line.slice(2))}</p>`)
      continue
    }

    // Unordered list
    if (line.match(/^[-*]\s+/)) {
      if (!inList) {
        closeLists()
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }

    // Regular paragraph
    closeLists()
    html.push(`<p>${inline(line)}</p>`)
  }
  closeLists()

  return html.join('\n')
}

/**
 * Wrap rendered HTML content in a themed template for export.
 * Inline CSS mimics the app's paper/ink theme (PRD §10).
 */
export function wrapExportHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body {
    font-family: "Noto Serif SC", "Songti SC", serif;
    max-width: 720px;
    margin: 2em auto;
    padding: 0 1.5em;
    color: #5C4033;
    line-height: 1.8;
    font-size: 16px;
  }
  h1 { font-size: 1.6em; border-bottom: 2px solid #5C4033; padding-bottom: 0.3em; }
  h2 { font-size: 1.3em; }
  h3 { font-size: 1.1em; }
  blockquote {
    border-left: 3px solid #5C4033;
    margin-left: 0;
    padding-left: 1em;
    color: #7a6a5a;
  }
  .wikilink { color: #8B4513; text-decoration: underline; text-decoration-style: dotted; }
  code { background: #f5f0e8; padding: 0.1em 0.3em; border-radius: 3px; }
  @media print {
    body { margin: 0; max-width: none; padding: 1em; }
    h1, h2 { page-break-after: avoid; }
    .note-section { page-break-before: always; }
  }
</style>
</head>
<body>
<h1>${title}</h1>
${bodyHtml}
</body>
</html>`
}

/**
 * Export notes to MD/HTML files. PDF is handled by the IPC layer (which has
 * access to BrowserWindow); this function prepares the content and writes
 * MD/HTML to disk. Returns file paths.
 *
 * For PDF format, this returns assembled HTML strings; the IPC handler does
 * the BrowserWindow.printToPDF call and file write.
 */
export function exportNotes(
  input: ExportInput,
): ExportResult {
  const db = getDb()
  const notes = input.note_ids.map((id) => {
    const row = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(id)
    if (!row) throw new AppError('NOT_FOUND', `笔记 ${id} 不存在`)
    return rowToNote(row)
  })

  mkdirSync(input.out_dir, { recursive: true })
  const files: string[] = []

  if (input.format === 'md') {
    if (input.bundle) {
      const md = notes
        .map((n) => `# ${n.title}\n\n${n.content}`)
        .join('\n\n---\n\n')
      const file = resolve(input.out_dir, 'notes-export.md')
      writeFileSync(file, md, 'utf-8')
      files.push(file)
    } else {
      for (const n of notes) {
        const file = resolve(input.out_dir, sanitizeFilename(n.title) + '.md')
        writeFileSync(file, `# ${n.title}\n\n${n.content}`, 'utf-8')
        files.push(file)
      }
    }
  } else if (input.format === 'html') {
    if (input.bundle) {
      const body = notes
        .map(
          (n) =>
            `<section class="note-section"><h2>${escapeHtml(n.title)}</h2>\n${markdownToHtml(n.content)}</section>`,
        )
        .join('\n')
      const html = wrapExportHtml('笔记导出', body)
      const file = resolve(input.out_dir, 'notes-export.html')
      writeFileSync(file, html, 'utf-8')
      files.push(file)
    } else {
      for (const n of notes) {
        const html = wrapExportHtml(n.title, markdownToHtml(n.content))
        const file = resolve(input.out_dir, sanitizeFilename(n.title) + '.html')
        writeFileSync(file, html, 'utf-8')
        files.push(file)
      }
    }
  }
  // PDF format: return assembled HTML; IPC handler does printToPDF.
  // (handled in ipc/notes.ts which has BrowserWindow access)

  return { files }
}

/**
 * Prepare HTML for PDF export. Called by the IPC handler to get the HTML
 * content before passing it to BrowserWindow.printToPDF.
 */
export function prepareExportHtml(noteIds: string[], bundle: boolean): { title: string; html: string }[] {
  const db = getDb()
  const notes = noteIds.map((id) => {
    const row = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(id)
    if (!row) throw new AppError('NOT_FOUND', `笔记 ${id} 不存在`)
    return rowToNote(row)
  })

  if (bundle) {
    const body = notes
      .map(
        (n) =>
          `<section class="note-section"><h2>${escapeHtml(n.title)}</h2>\n${markdownToHtml(n.content)}</section>`,
      )
      .join('\n')
    return [{ title: '笔记导出', html: wrapExportHtml('笔记导出', body) }]
  }

  return notes.map((n) => ({
    title: n.title,
    html: wrapExportHtml(n.title, markdownToHtml(n.content)),
  }))
}

/**
 * Paragraph-level combined export (NOTE-04特色): original text + AI modern
 * interpretation + image + linked notes.
 */
export function exportParagraphCombined(
  input: ExportParagraphInput,
): { title: string; md: string; html: string } {
  const db = getDb()
  const para = db
    .prepare(
      `SELECT p.id,
              p.chapter_id,
              p.text,
              ${ACTIVE_ANALYSIS_SELECT}
       FROM paragraphs p
       ${ACTIVE_ANALYSIS_JOIN}
       WHERE p.id = ? AND p.deleted_at IS NULL`,
    )
    .get(input.paragraph_id) as
    | {
        id: string
        chapter_id: string
        text: string
        content_modern: string | null
        content_explanation: string | null
        content_analysis: string | null
      }
    | undefined
  if (!para) {
    throw new AppError('NOT_FOUND', `段落 ${input.paragraph_id} 不存在`)
  }

  const chap = db
    .prepare('SELECT title FROM chapters WHERE id = ?')
    .get(para.chapter_id) as { title: string } | undefined

  const sections: string[] = []
  if (input.include.original) {
    sections.push(`## 原文\n\n${para.text}`)
  }
  if (input.include.modern) {
    sections.push(
      `## 白话解读\n\n${para.content_modern ?? '（未生成）'}\n\n## 医理点拨\n\n${para.content_explanation ?? ''}\n\n## 内容解读\n\n${para.content_analysis ?? ''}`,
    )
  }
  if (input.include.notes) {
    const linkedNotes = db
      .prepare(
        `SELECT id, title, content FROM notes WHERE paragraph_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
      )
      .all(input.paragraph_id) as Array<{ id: string; title: string; content: string }>
    for (const nt of linkedNotes) {
      sections.push(`## 笔记：${nt.title}\n\n${nt.content}`)
    }
  }

  const md = sections.join('\n\n---\n\n')
  const title = chap ? `段落导出 · ${chap.title}` : '段落导出'
  const html = wrapExportHtml(title, markdownToHtml(md))

  return { title, md, html }
}

// ===========================================================================
// Helpers
// ===========================================================================

function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars from filenames is intentional
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'untitled'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
