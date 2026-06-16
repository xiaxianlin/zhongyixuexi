import { useCallback, useEffect, useRef, useState } from 'react'
import { segmentApi } from '@/lib/ipc'
import type { SegmentParagraph } from '@/lib/types'

export function SegmentEditor({ chapterId }: { chapterId: string }) {
  const [segs, setSegs] = useState<SegmentParagraph[]>([])
  const [loading, setLoading] = useState(true)
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const refresh = useCallback(async () => {
    setSegs(await segmentApi.list(chapterId))
    setLoading(false)
  }, [chapterId])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      await fn()
      await refresh()
    },
    [refresh],
  )

  if (loading) return <p className="lib__progress">加载段落…</p>
  if (segs.length === 0) return <p className="lib__empty">本章无段落。</p>

  return (
    <div className="seg">
      <div className="seg__head">
        <h3>段级校对（共 {segs.length} 段）</h3>
        <span className="seg__hint">编辑后失焦自动保存；拆分在光标处进行。</span>
      </div>
      {segs.map((s, i) => (
        <div key={s.id} className={`seg__row${s.is_noise ? ' seg__row--noise' : ''}`}>
          <div className="seg__num" title={s.edited ? '已编辑' : undefined}>
            {i + 1}
            {s.edited ? '·' : ''}
          </div>
          <textarea
            className="seg__text"
            ref={(el) => {
              refs.current[s.id] = el
            }}
            defaultValue={s.text}
            onBlur={(e) => {
              if (e.target.value !== s.text) void act(() => segmentApi.updateText(s.id, e.target.value))
            }}
          />
          <div className="seg__actions">
            <button title="与下段合并" onClick={() => void act(() => segmentApi.mergeNext(s.id))}>
              合并
            </button>
            <button
              title="在光标处拆分"
              onClick={() => {
                const off = refs.current[s.id]?.selectionStart ?? s.text.length
                void act(() => segmentApi.split(s.id, off))
              }}
            >
              拆分
            </button>
            <button
              title={s.is_noise ? '取消噪声标记' : '标记为噪声'}
              onClick={() => void act(() => segmentApi.setNoise(s.id, !s.is_noise))}
            >
              {s.is_noise ? '取消噪' : '噪声'}
            </button>
            <button title="删除该段" onClick={() => void act(() => segmentApi.remove(s.id))}>
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
