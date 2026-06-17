/**
 * Learning dashboard.
 */

import { useCallback, useEffect, useState } from 'react'
import { learningApi } from '@/lib/learning-api'
import type { DashboardDTO } from './types'
import './learning.css'

export function Dashboard() {
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

      <div className="dashboard__top">
        <ProgressRing percent={analysisPct} analyzed={data.analyzedParagraphs} total={data.totalParagraphs} />
        <div className="dashboard__stats">
          <StatCard label="书籍" value={String(data.totalBooks)} />
          <StatCard label="章节" value={String(data.totalChapters)} />
          <StatCard label="笔记" value={String(data.noteCount)} />
          <StatCard label="阅读时长" value={formatDuration(data.totalReadSeconds)} />
        </div>
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

      <Heatmap data={data.heatmap} />
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard__stat-card">
      <span className="dashboard__stat-value">{value}</span>
      <span className="dashboard__stat-label">{label}</span>
    </div>
  )
}

function ProgressRing({ percent, analyzed, total }: { percent: number; analyzed: number; total: number }) {
  const r = 52
  const c = 2 * Math.PI * r
  const offset = c - (percent / 100) * c
  return (
    <div className="dashboard__ring-wrap">
      <svg className="dashboard__ring" width="120" height="120" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="8"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="dashboard__ring-text">
        <span className="dashboard__ring-pct">{percent}%</span>
        <span className="dashboard__ring-sub">{analyzed}/{total} 已分析</span>
      </div>
    </div>
  )
}

function Heatmap({ data }: { data: Record<string, number> }) {
  const year = new Date().getFullYear()
  const days: { day: string; count: number }[] = []

  // Build last 365 days (or current year)
  const start = new Date(year, 0, 1)
  const today = new Date()
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ day: key, count: data[key] ?? 0 })
  }

  return (
    <div className="dashboard__section">
      <h4>{year} 学习热力图</h4>
      <div className="heatmap">
        {days.map((d) => (
          <div
            key={d.day}
            className={`heatmap__cell ${heatLevel(d.count)}`}
            title={`${d.day}: ${d.count} 次学习`}
          />
        ))}
      </div>
      <div className="heatmap__legend">
        <span>少</span>
        <div className="heatmap__cell heatmap__cell--l0" />
        <div className="heatmap__cell heatmap__cell--l1" />
        <div className="heatmap__cell heatmap__cell--l2" />
        <div className="heatmap__cell heatmap__cell--l3" />
        <div className="heatmap__cell heatmap__cell--l4" />
        <span>多</span>
      </div>
    </div>
  )
}

function heatLevel(count: number): string {
  if (count === 0) return 'heatmap__cell--l0'
  if (count <= 2) return 'heatmap__cell--l1'
  if (count <= 5) return 'heatmap__cell--l2'
  if (count <= 10) return 'heatmap__cell--l3'
  return 'heatmap__cell--l4'
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} 小时`
}
