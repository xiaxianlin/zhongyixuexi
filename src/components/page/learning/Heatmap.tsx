/**
 * Heatmap — yearly activity heatmap (interaction component, page-level).
 * Pure props: a {day: count} map. Renders cells for the current year up to
 * today. Page-private to LearningView. Intensity bucketing via heatLevel().
 */
import { heatLevel } from '@/models/learning/helpers'

interface HeatmapProps {
  data: Record<string, number>
}

export function Heatmap({ data }: HeatmapProps) {
  const year = new Date().getFullYear()
  const days: { day: string; count: number }[] = []

  // Build current year up to today.
  const start = new Date(year, 0, 1)
  const today = new Date()
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ day: key, count: data[key] ?? 0 })
  }

  return (
    <div className="dashboard__section">
      <div className="heatmap__head">
        <h4>{year} 学习热力图</h4>
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
      <div className="heatmap">
        {days.map((d) => (
          <div
            key={d.day}
            className={`heatmap__cell ${heatLevel(d.count)}`}
            title={`${d.day}: ${d.count} 次学习`}
          />
        ))}
      </div>
    </div>
  )
}
