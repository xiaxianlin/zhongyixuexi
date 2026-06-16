import { BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { handle } from './registry'
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  getNotesByParagraph,
  getNotesByChapter,
  listNotes,
  getOutlinks,
  getBacklinks,
  resolveLinkTarget,
  searchNotes,
  listTags,
  setTags,
  getTagsForRef,
  ensureTag,
  listNotebooks,
  createNotebook,
  renameNotebook,
  deleteNotebook,
  exportNotes,
  prepareExportHtml,
  exportParagraphCombined,
  type CreateNoteInput,
  type UpdateNoteInput,
  type ListFilter,
  type LinkTargetType,
  type ExportInput,
  type ExportParagraphInput,
} from '../services/notes'

/**
 * Notes IPC (NOTE-01 ~ NOTE-04). Thin pass-throughs to the notes service.
 * Every handler returns via the {__ok} envelope from registry.handle.
 * Channel names follow the module:action convention (00-arch §4).
 *
 * PDF export (NOTE-04) uses Electron's built-in Chromium (BrowserWindow
 * .printToPDF) to avoid bundling puppeteer — this file has access to the
 * Electron API so it handles the PDF rendering step.
 *
 * Renderer→main typed wrappers live in src/lib/notes-api.ts.
 */
export function registerNotesHandlers(): void {
  // --- NOTE-01 / NOTE-05: CRUD ---

  handle('notes:create', (_event, input: unknown) =>
    createNote(input as CreateNoteInput),
  )

  handle('notes:get', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { id?: string }
    return getNote(p.id ?? '')
  })

  handle('notes:update', (_event, input: unknown) =>
    updateNote(input as UpdateNoteInput),
  )

  handle('notes:delete', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { id?: string }
    deleteNote(p.id ?? '')
    return { ok: true }
  })

  // NOTE-05: reading sidebar high-frequency query.
  handle('notes:getByParagraph', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { paragraph_id?: string }
    return getNotesByParagraph(p.paragraph_id ?? '')
  })

  handle('notes:getByChapter', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { chapter_id?: string }
    return getNotesByChapter(p.chapter_id ?? '')
  })

  handle('notes:list', (_event, payload: unknown) => {
    const p = (payload ?? {}) as ListFilter
    return listNotes(p)
  })

  // --- NOTE-02: wiki-links + backlinks ---

  handle('notes:getOutlinks', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { note_id?: string }
    return getOutlinks(p.note_id ?? '')
  })

  handle('notes:getBacklinks', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { target_type?: LinkTargetType; target_id?: string }
    return getBacklinks(p.target_type ?? 'note', p.target_id ?? '')
  })

  handle('notes:resolveLinkTarget', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { raw?: string }
    return resolveLinkTarget(p.raw ?? '')
  })

  // --- NOTE-03: search + tags + notebooks ---

  handle('notes:search', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { query?: string; notebook_id?: string; limit?: number }
    return searchNotes(p.query ?? '', {
      notebook_id: p.notebook_id,
      limit: p.limit,
    })
  })

  handle('notes:listTags', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { ref_type?: string }
    return listTags(p.ref_type)
  })

  handle('notes:setTags', (_event, payload: unknown) => {
    const p = (payload ?? {}) as {
      ref_type?: string
      ref_id?: string
      tag_ids?: string[]
    }
    return setTags(p.ref_type ?? 'note', p.ref_id ?? '', p.tag_ids ?? [])
  })

  handle('notes:getTagsForRef', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { ref_type?: string; ref_id?: string }
    return getTagsForRef(p.ref_type ?? 'note', p.ref_id ?? '')
  })

  handle('notes:ensureTag', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { name?: string; color?: string | null }
    return ensureTag(p.name ?? '', p.color)
  })

  handle('notes:listNotebooks', () => listNotebooks())

  handle('notes:createNotebook', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { name?: string; parent_id?: string | null }
    return createNotebook(p.name ?? '', p.parent_id)
  })

  handle('notes:renameNotebook', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { id?: string; name?: string }
    return renameNotebook(p.id ?? '', p.name ?? '')
  })

  handle('notes:deleteNotebook', (_event, payload: unknown) => {
    const p = (payload ?? {}) as { id?: string }
    deleteNotebook(p.id ?? '')
    return { ok: true }
  })

  // --- NOTE-04: export ---

  handle('notes:export', async (event, payload: unknown) => {
    const input = (payload ?? {}) as ExportInput
    if (input.format === 'pdf') {
      // PDF: use Electron's BrowserWindow.printToPDF (avoids puppeteer dependency).
      return exportNotesPdf(input, (_current, _total, _file) => {
        // Progress reporting via webContents.
        const win = BrowserWindow.fromWebContents(event.sender)
        win?.webContents.send('notes:exportProgress', {
          current: _current,
          total: _total,
          file: _file,
        })
      })
    }
    return exportNotes(input)
  })

  handle('notes:exportParagraph', async (event, payload: unknown) => {
    const input = (payload ?? {}) as ExportParagraphInput
    const combined = exportParagraphCombined(input)

    if (input.format === 'md') {
      mkdirSync(input.out_dir, { recursive: true })
      const file = resolve(input.out_dir, sanitizeFilename(combined.title) + '.md')
      writeFileSync(file, combined.md, 'utf-8')
      return { file }
    }

    if (input.format === 'html') {
      mkdirSync(input.out_dir, { recursive: true })
      const file = resolve(input.out_dir, sanitizeFilename(combined.title) + '.html')
      writeFileSync(file, combined.html, 'utf-8')
      return { file }
    }

    // PDF
    mkdirSync(input.out_dir, { recursive: true })
    const file = resolve(input.out_dir, sanitizeFilename(combined.title) + '.pdf')
    await renderPdf(combined.html, file)
    return { file }
  })
}

/**
 * Export notes to PDF using Electron's built-in Chromium via a hidden
 * BrowserWindow + webContents.printToPDF. Avoids bundling puppeteer.
 */
async function exportNotesPdf(
  input: ExportInput,
  _onProgress: (current: number, total: number, file: string) => void,
): Promise<{ files: string[] }> {
  mkdirSync(input.out_dir, { recursive: true })
  const htmlDocs = prepareExportHtml(input.note_ids, input.bundle ?? false)
  const files: string[] = []

  for (let i = 0; i < htmlDocs.length; i++) {
    const doc = htmlDocs[i]!
    const filename =
      input.bundle ?? htmlDocs.length === 1
        ? sanitizeFilename(doc.title) + '.pdf'
        : `${sanitizeFilename(doc.title)}-${i + 1}.pdf`
    const file = resolve(input.out_dir, filename)
    await renderPdf(doc.html, file)
    files.push(file)
    _onProgress(i + 1, htmlDocs.length, file)
  }

  return { files }
}

/** Render HTML to a PDF file using a hidden BrowserWindow. */
async function renderPdf(html: string, outFile: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false },
  })

  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdfData = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
    })
    writeFileSync(outFile, pdfData)
  } catch (err) {
    throw new Error(`PDF 渲染失败: ${(err as Error).message}`, { cause: err })
  } finally {
    win.destroy()
  }
}

function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars from filenames is intentional
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) || 'untitled'
}
