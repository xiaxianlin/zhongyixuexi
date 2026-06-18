/**
 * StatCard — single dashboard stat (interaction component, page-level).
 * Pure props: a label + value pair. Page-private to LearningView.
 */
interface StatCardProps {
  label: string
  value: string
}

export function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="dashboard__stat-card">
      <span className="dashboard__stat-value">{value}</span>
      <span className="dashboard__stat-label">{label}</span>
    </div>
  )
}
