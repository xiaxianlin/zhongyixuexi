/**
 * NotesView — the main notes module entry point (NOTE-01 ~ NOTE-04).
 *
 * Three-pane layout:
 *  - Left: Note list (with notebook tree + search)
 *  - Center: Editor (textarea + preview split — lightweight MVP, avoids
 *    Milkdown dependency for the first slice; the 06-notes.md design doc
 *    recommends Milkdown for the full WYSIWYG experience, which can be
 *    swapped in later by replacing this editor component)
 *  - Right: Backlinks + outlinks panel (NOTE-02)
 *
 * The editor uses a simple textarea + live preview approach. Wiki-links
 * [[ ]] are rendered as dotted-underline spans in the preview. Content is
 * saved via debounced notes:update (800ms after last keystroke or on blur).
 */

import { useCallback, useEffect, useState } from 'react'
import { useNotesStore } from '@/stores/notes'
import { notesApi } from '@/lib/notes-api'
import { splitWikiLinks } from './wikiLinks'
import type { Backlink, NoteLink } from './types'
import './notes.css'

export function NotesView() {
  const {
    list,
    total,
    loading,
    refreshList,
    currentId,
    current,
    draft,
    draftTitle,
    saving,
    openNote,
    closeNote,
    setDraft,
    setDraftTitle,
    saveDraft,
    createNote,
    deleteNote,
    backlinks,
    outlinks,
    notebooks,
    tags,
    refreshNotebooks,
    refreshTags,
  } = useNotesStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ note_id: string; title: string; snippet: string }[]>([])
  const [showPreview, setShowPreview] = useState(true)
  const [exportBusy, setExportBusy] = useState(false)

  useEffect(() => {
    void refreshList()
    void refreshNotebooks()
    void refreshTags()
  }, [refreshList, refreshNotebooks, refreshTags])

  // Search debounce.
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setSearchResults([])
      return
    }
    const timer = setTimeout(async () => {
      const res = await notesApi.search(searchQuery)
      setSearchResults(res.items)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Flush on unmount.
  useEffect(() => {
    return () => {
      closeNote()
    }
  }, [closeNote])

  const handleCreate = useCallback(async () => {
    await createNote()
  }, [createNote])

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteNote(id)
    },
    [deleteNote],
  )

  const handleExport = useCallback(
    async (format: 'md' | 'html' | 'pdf') => {
      if (!currentId) return
      setExportBusy(true)
      try {
        const outDir = await notesApiExportDir()
        await notesApi.export({
          note_ids: [currentId],
          format,
          out_dir: outDir,
          bundle: false,
        })
      } catch (err) {
        console.error('export failed', err)
      } finally {
        setExportBusy(false)
      }
    },
    [currentId],
  )

  return (
    <div className="notes">
      {/* Left: list panel */}
      <aside className="notes__list">
        <div className="notes__listToolbar">
          <input
            className="notes__search"
            type="text"
            placeholder="搜索笔记..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="notes__newBtn" onClick={handleCreate}>
            + 新建
          </button>
        </div>

        {searchResults.length > 0 ? (
          <ul className="notes__items">
            {searchResults.map((r) => (
              <li
                key={r.note_id}
                className={`notes__item ${currentId === r.note_id ? 'is-active' : ''}`}
                onClick={() => void openNote(r.note_id)}
              >
                <div className="notes__itemTitle">{r.title}</div>
                <div
                  className="notes__itemPreview"
                  dangerouslySetInnerHTML={{ __html: r.snippet }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <>
            {notebooks.length > 0 && (
              <div className="notes__notebooks">
                {notebooks.map((nb) => (
                  <div key={nb.id} className="notes__notebook">
                    <span className="notes__notebookIcon">{nb.icon || '▸'}</span>
                    {nb.name}
                    {nb.children.length > 0 && (
                      <div className="notes__notebookChildren">
                        {nb.children.map((child) => (
                          <div key={child.id} className="notes__notebookChild">
                            {child.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="notes__listHeader">
              全部笔记 ({total})
            </div>

            {loading ? (
              <div className="notes__loading">加载中...</div>
            ) : list.length === 0 ? (
              <div className="notes__empty">还没有笔记，点击「新建」创建第一篇。</div>
            ) : (
              <ul className="notes__items">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className={`notes__item ${currentId === item.id ? 'is-active' : ''} ${item.pinned ? 'is-pinned' : ''}`}
                    onClick={() => void openNote(item.id)}
                  >
                    {item.pinned && <span className="notes__pin">★</span>}
                    <div className="notes__itemTitle">{item.title}</div>
                    <div className="notes__itemPreview">{item.preview.slice(0, 60)}</div>
                    <button
                      className="notes__itemDel"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDelete(item.id)
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {tags.length > 0 && (
          <div className="notes__tags">
            <div className="notes__tagsHeader">标签</div>
            <div className="notes__tagCloud">
              {tags.map((t) => (
                <span key={t.id} className="notes__tag" style={t.color ? { color: t.color } : undefined}>
                  #{t.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Center: editor */}
      <section className="notes__editor">
        {current ? (
          <>
            <div className="notes__editorToolbar">
              <input
                className="notes__titleInput"
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="笔记标题"
              />
              <button
                className={`notes__viewBtn ${!showPreview ? 'is-active' : ''}`}
                onClick={() => setShowPreview(!showPreview)}
                title="切换预览"
              >
                {showPreview ? '纯编辑' : '分屏'}
              </button>
              <div className="notes__exportBtns">
                <button disabled={exportBusy} onClick={() => handleExport('md')} title="导出 Markdown">
                  MD
                </button>
                <button disabled={exportBusy} onClick={() => handleExport('html')} title="导出 HTML">
                  HTML
                </button>
                <button disabled={exportBusy} onClick={() => handleExport('pdf')} title="导出 PDF">
                  PDF
                </button>
              </div>
              {saving && <span className="notes__saving">保存中...</span>}
            </div>

            <div className={`notes__editorBody ${showPreview ? 'is-split' : ''}`}>
              <textarea
                className="notes__textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => void saveDraft()}
                placeholder="开始写笔记... 支持双链 [[目标]] 引用章节、段落、术语或笔记"
                spellCheck={false}
              />
              {showPreview && (
                <div className="notes__preview">
                  <NotePreview markdown={draft} onLinkClick={() => {
                    // TODO: navigate to linked entity (paragraph/chapter/note)
                  }} />
                </div>
              )}
            </div>

            {current.paragraph_id && (
              <div className="notes__boundInfo">
                绑定段落: {current.paragraph_id.slice(0, 8)}...
              </div>
            )}
          </>
        ) : (
          <div className="notes__editorEmpty">
            <p>选择一篇笔记或创建新笔记开始编辑。</p>
            <button className="notes__createBtn" onClick={handleCreate}>
              创建新笔记
            </button>
          </div>
        )}
      </section>

      {/* Right: backlinks + outlinks */}
      <aside className="notes__context">
        <BacklinkPanel backlinks={backlinks} onOpen={(id) => void openNote(id)} />
        <OutlinkPanel outlinks={outlinks} />
      </aside>
    </div>
  )
}

/** Simple Markdown preview that renders wiki-links as clickable spans. */
function NotePreview({ markdown, onLinkClick }: { markdown: string; onLinkClick: (target: string) => void }) {
  const lines = markdown.split('\n')
  return (
    <div className="note-preview">
      {lines.map((line, i) => (
        <PreviewLine key={i} line={line} onLinkClick={onLinkClick} />
      ))}
    </div>
  )
}

function PreviewLine({ line, onLinkClick }: { line: string; onLinkClick: (target: string) => void }) {
  // Simple heading detection.
  const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
  if (headingMatch) {
    const level = headingMatch[1]!.length
    const segments = splitWikiLinks(headingMatch[2]!)
    const Tag = (`h${Math.min(level + 1, 6)}`) as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
    return <Tag>{renderSegments(segments, onLinkClick)}</Tag>
  }
  if (line.trim() === '') return <br />
  const segments = splitWikiLinks(line)
  return <p>{renderSegments(segments, onLinkClick)}</p>
}

function renderSegments(
  segments: ReturnType<typeof splitWikiLinks>,
  onLinkClick: (target: string) => void,
) {
  return segments.map((seg, i) => {
    if (seg.isWikiLink) {
      return (
        <span
          key={i}
          className="note-preview__wikilink"
          title={seg.rawTarget}
          onClick={() => seg.rawTarget && onLinkClick(seg.rawTarget)}
        >
          {seg.displayText}
        </span>
      )
    }
    return <span key={i}>{seg.text}</span>
  })
}

function BacklinkPanel({
  backlinks,
  onOpen,
}: {
  backlinks: Backlink[]
  onOpen: (noteId: string) => void
}) {
  return (
    <div className="notes__backlinks">
      <div className="notes__panelTitle">反向链接 ({backlinks.length})</div>
      {backlinks.length === 0 ? (
        <div className="notes__panelEmpty">暂无反向链接</div>
      ) : (
        <ul className="notes__backlinkList">
          {backlinks.map((bl) => (
            <li
              key={bl.id}
              className="notes__backlinkItem"
              onClick={() => onOpen(bl.source_note_id)}
            >
              <div className="notes__backlinkTitle">{bl.note_title}</div>
              {bl.display_text && (
                <div className="notes__backlinkText">→ {bl.display_text}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OutlinkPanel({ outlinks }: { outlinks: NoteLink[] }) {
  return (
    <div className="notes__outlinks">
      <div className="notes__panelTitle">出链 ({outlinks.length})</div>
      {outlinks.length === 0 ? (
        <div className="notes__panelEmpty">暂无出链</div>
      ) : (
        <ul className="notes__outlinkList">
          {outlinks.map((ol) => (
            <li key={ol.id} className="notes__outlinkItem">
              <span className="notes__outlinkType">{ol.target_type}</span>
              <span className={ol.target_valid === false ? 'notes__outlinkInvalid' : ''}>
                {ol.target_title || ol.display_text || ol.target_alias}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Placeholder for getting the export directory. In a real app this would
 * show a directory picker; for now we use the OS temp/userData dir via IPC.
 * Since we can't modify ipc.ts, we use a simple convention.
 */
async function notesApiExportDir(): Promise<string> {
  // The export IPC handler receives out_dir; for MVP we use a default.
  // A proper directory picker would be added to the SET or NOTE module later.
  return `${Date.now()}`
}
