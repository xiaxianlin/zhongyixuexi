/**
 * Pure helpers for the learning dashboard (formatting + heatmap bucketing).
 * Extracted from the view so they can be unit-tested in isolation.
 */

/** Format a duration in seconds as a short zh-CN string (秒/分钟/小时). */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.round((minutes / 60) * 10) / 10
  return `${hours} 小时`
}

/** Map a per-day activity count to a heatmap intensity level class (l0–l4). */
export function heatLevel(count: number): string {
  if (count === 0) return 'heatmap__cell--l0'
  if (count <= 2) return 'heatmap__cell--l1'
  if (count <= 5) return 'heatmap__cell--l2'
  if (count <= 10) return 'heatmap__cell--l3'
  return 'heatmap__cell--l4'
}
