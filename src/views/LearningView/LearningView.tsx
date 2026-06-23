/**
 * LearningView — the 学习 (learning footprint dashboard) route.
 *
 * Pure View: loads the dashboard DTO from the learning model and composes the
 * header + ProgressRing + StatCards + recent-books + Heatmap from the page
 * components under components/page/learning/.
 */
import { useCallback, useEffect, useState } from 'react'
import { learningApi } from '@/models/learning/api'
import { formatDuration } from '@/models/learning/helpers'
import type { DashboardDTO } from '@/models/learning/types'
import { ProgressRing } from '@/components/page/learning/ProgressRing'
import { StatCard } from '@/components/page/learning/StatCard'
import { Heatmap } from '@/components/page/learning/Heatmap'
import './learning.css'

export function LearningView() {
  const [data, setData] = useState<DashboardDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await learningApi.getDashboard()
      setData(d)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <div className="dashboard"><p className="dashboard__error">{error}</p></div>
  if (!data) return <div className="dashboard"><p>加载仪表盘…</p></div>

  const analysisPct = Math.round(data.analysisRate * 100)

  return (
    <div className="dashboard">
      <header className="dashboard__hero">
        <div>
          <p className="dashboard__eyebrow">学习仪表盘</p>
          <h2>学习总览</h2>
        </div>
        <p className="dashboard__heroMeta">阅读、分析、笔记的学习进度</p>
      </header>

      <div className="dashboard__row">
        <div className="dashboard__top">
          <ProgressRing percent={analysisPct} caption="已解读章节" />
          <div className="dashboard__stats">
            <StatCard label="书籍" value={String(data.totalBooks)} />
            <StatCard label="章节" value={String(data.totalChapters)} />
            <StatCard label="笔记" value={String(data.noteCount)} />
            <StatCard label="摘录" value={String(data.excerptCount)} />
            <StatCard label="阅读时长" value={formatDuration(data.totalReadSeconds)} />
          </div>
        </div>

        <Heatmap data={data.heatmap} />
      </div>

      {data.recentBooks.length > 0 && (
        <section className="dashboard__section">
          <h4>最近阅读</h4>
          <div className="dashboard__recent">
            {data.recentBooks.map((book) => (
              <article key={book.book_id} className="dashboard__recentBook">
                <span className="dashboard__recentTitle">{book.title}</span>
                <span className="dashboard__recentMeta">{Math.round(book.percent * 100)}%</span>
              </article>
            ))}
          </div>
        </section>
      )}

    </div>
  )
}
