/**
 * Learning Dashboard (LRN-06 — 04-learning.md §7.5).
 *
 * Shows: mastery ring, streak badge, total cards, and yearly learning heatmap.
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
      <header className="dashboard__hero">
        <div>
          <p className="dashboard__eyebrow">学习仪表盘</p>
          <h2>学习总览</h2>
        </div>
        <p className="dashboard__heroMeta">读过多少，掌握多少，日日积累多少</p>
      </header>

      <div className="dashboard__top">
        <MasteryRing percent={masteryPct} mastered={data.mastered} total={data.totalCards} />
        <div className="dashboard__stats">
          <StatCard label="连续学习" value={`${data.streak} 天`} />
          <StatCard label="已掌握" value={String(data.mastered)} />
          <StatCard label="学习卡片" value={String(data.totalCards)} />
        </div>
      </div>

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
      <h4>{year} 学习热力图</h4>
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
