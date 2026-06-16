/**
 * ResourcePanel — right column (RD-04). Switches between a resource view
 * (AI 配图 / 经络图 / 关联方剂 — all placeholders until the AI & SRH modules
 * feed real data in later phases) and a notes mode (a lightweight entry point
 * that defers to the NOTE module's editor when it lands).
 *
 * The panel also surfaces the bookmarks for the current book (RD-08) so the
 * "resource" slot is never empty in Phase 2: bookmarks are real (RD owns them),
 * images/notes are pending cross-module data.
 */
import { useEffect } from 'react'
import { readingApi } from '@/lib/reading-api'
import { useReadingStore } from './store'
import type { BookmarkDTO } from './types'

interface ResourcePanelProps {
  /** Jump to a paragraph (opens the chapter + scrolls). */
  onJumpParagraph?: (chapterId: string, paragraphId: string | null) => void
}

export function ResourcePanel({ onJumpParagraph }: ResourcePanelProps): React.ReactElement {
  const mode = useReadingStore((s) => s.layout.resource.mode)
  const setResourceMode = useReadingStore((s) => s.setResourceMode)
  const bookmarks = useReadingStore((s) => s.bookmarks)
  const setBookmarks = useReadingStore((s) => s.setBookmarks)
  const bookId = useReadingStore((s) => s.bookId)
  const chapterId = useReadingStore((s) => s.chapterId)
  const topParagraphId = useReadingStore((s) => s.topParagraphId)

  const onRemove = async (id: string): Promise<void> => {
    await readingApi.removeBookmark(id)
    if (bookId) setBookmarks((await readingApi.listBookmarks(bookId)))
  }

  const onAddCurrent = async (): Promise<void> => {
    if (!bookId || !chapterId || !topParagraphId) return
    await readingApi.addBookmark({
      book_id: bookId,
      chapter_id: chapterId,
      paragraph_id: topParagraphId,
    })
    setBookmarks(await readingApi.listBookmarks(bookId))
  }

  // Bookmarks refresh on book change (the workbench triggers the initial load;
  // this effect catches subsequent changes and is harmless when bookId is null).
  useEffect(() => {
    if (!bookId) return
    let alive = true
    void readingApi.listBookmarks(bookId).then((b) => {
      if (alive) setBookmarks(b)
    })
    return () => {
      alive = false
    }
  }, [bookId, setBookmarks])

  return (
    <section className="rpanel">
      <header className="rpanel__bar">
        <div className="rpanel__tabs">
          <button
            type="button"
            className={`rpanel__tab${mode === 'resource' ? ' rpanel__tab--on' : ''}`}
            onClick={() => setResourceMode('resource')}
          >
            资源
          </button>
          <button
            type="button"
            className={`rpanel__tab${mode === 'notes' ? ' rpanel__tab--on' : ''}`}
            onClick={() => setResourceMode('notes')}
          >
            笔记
          </button>
        </div>
      </header>

      {mode === 'resource' ? (
        <div className="rpanel__scroll">
          {/* Bookmarks are real RD data — always available in Phase 2. */}
          <div className="rpanel__section">
            <div className="rpanel__sectionhead">
              <span>书签</span>
              <button
                type="button"
                className="rpanel__add"
                onClick={() => void onAddCurrent()}
                disabled={!topParagraphId}
                title="为当前段添加书签"
              >
                + 当前段
              </button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="rpanel__empty">暂无书签。</p>
            ) : (
              <ul className="rpanel__bmlist">
                {bookmarks.map((b: BookmarkDTO) => (
                  <li key={b.id} className="rpanel__bmitem">
                    <button
                      type="button"
                      className="rpanel__bmjump"
                      onClick={() =>
                        onJumpParagraph?.(b.chapter_id, b.paragraph_id)
                      }
                      title={b.note ?? undefined}
                    >
                      <span className="rpanel__bmtitle">{b.title ?? '(无标题)'}</span>
                      <span className="rpanel__bmscope">
                        {b.paragraph_id ? '段' : '章'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rpanel__bmdel"
                      onClick={() => void onRemove(b.id)}
                      aria-label="删除书签"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* AI 配图 / 经络图 / 关联方剂 — placeholders pending 07-ai / 05-srh. */}
          <div className="rpanel__section rpanel__section--muted">
            <div className="rpanel__sectionhead">
              <span>AI 配图</span>
            </div>
            <p className="rpanel__placeholder">待 AI 模块（Phase 5）生成。</p>
          </div>
          <div className="rpanel__section rpanel__section--muted">
            <div className="rpanel__sectionhead">
              <span>经络 · 关联方剂</span>
            </div>
            <p className="rpanel__placeholder">待检索模块（Phase 3）接入。</p>
          </div>
        </div>
      ) : (
        <div className="rpanel__scroll">
          {/* Notes mode: a thin entry point. The NOTE module (06) owns the editor;
              until it lands we show a placeholder pointing the user at the feature. */}
          <p className="rpanel__placeholder">
            笔记编辑将在笔记模块接入后可用。段级笔记会绑定到当前段（{topParagraphId ? '已选中' : '未选中'}）。
          </p>
        </div>
      )}
    </section>
  )
}
