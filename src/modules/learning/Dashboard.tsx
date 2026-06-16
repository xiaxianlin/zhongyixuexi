/**
 * Learning Dashboard (LRN-06 — 04-learning.md §7.5).
 *
 * Shows: mastery ring, streak badge, heatmap (GitHub-style), weak chapters,
 * recent 7-day trend.
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
      const d = await learningApi.getDashboard(365)
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

  const masteryPct = Math.round(data.masteryRate * 100)

  return (
    <div className="dashboard">
      <div className="dashboard__top">
        <MasteryRing percent={masteryPct} mastered={data.mastered} total={data.totalCards} />
        <div className="dashboard__stats">
          <StatCard label="今日待复习" value={String(data.dueToday)} />
          <StatCard label="连续学习" value={`${data.streak} 天`} />
          <StatCard label="总卡片" value={String(data.totalCards)} />
        </div>
      </div>

      <Heatmap data={data.heatmap} />

      <div className="dashboard__section">
        <h4>近 7 日复习</h4>
        <div className="dashboard__recent7">
          {data.recent7.length === 0 ? (
            <p className="dashboard__empty">暂无复习记录</p>
          ) : (
            data.recent7.map((d) => (
              <div key={d.day} className="dashboard__recent-bar">
                <span className="dashboard__recent-day">{d.day.slice(5)}</span>
                <div className="dashboard__bar">
                  <div className="dashboard__bar-fill" style={{ width: `${Math.min(d.reviewed * 5, 100)}%` }} />
                </div>
                <span className="dashboard__recent-count">{d.reviewed}</span>
                {d.again > 0 && <span className="dashboard__recent-again">({d.again}重来)</span>}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="dashboard__section">
        <h4>薄弱章节</h4>
        {data.weakChapters.length === 0 ? (
          <p className="dashboard__empty">暂无薄弱章节数据（需至少 3 张卡的章节）</p>
        ) : (
          <ul className="dashboard__weak">
            {data.weakChapters.map((ch) => (
              <li key={ch.chapter_id} className="dashboard__weak-item">
                <span className="dashboard__weak-title">{ch.title}</span>
                <span className="dashboard__weak-meta">
                  {ch.card_count} 卡 · 遗忘率 {Math.round(ch.lapse_rate * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
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

function MasteryRing({ percent, mastered, total }: { percent: number; mastered: number; total: number }) {
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
        <span className="dashboard__ring-sub">{mastered}/{total} 掌握</span>
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
      <h4>{year} 复习热力图</h4>
      <div className="heatmap">
        {days.map((d) => (
          <div
            key={d.day}
            className={`heatmap__cell ${heatLevel(d.count)}`}
            title={`${d.day}: ${d.count} 次`}
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
