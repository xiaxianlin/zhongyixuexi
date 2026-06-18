/**
 * ProgressRing — circular progress indicator (interaction component, page-level).
 * Pure props: percent + optional caption. Page-private to LearningView.
 */
interface ProgressRingProps {
  percent: number
  caption?: string
}

export function ProgressRing({ percent, caption }: ProgressRingProps) {
  const r = 52
  const c = 2 * Math.PI * r
  const offset = c - (percent / 100) * c
  return (
    <div className="dashboard__ring-wrap">
      <div className="dashboard__ring-box">
        <svg className="dashboard__ring" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet">
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
        </div>
      </div>
      {caption ? <p className="dashboard__ring-cap">{caption}</p> : null}
    </div>
  )
}
