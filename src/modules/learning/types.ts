/** Renderer-facing learning dashboard DTO. */

export interface DashboardDTO {
  totalCards: number
  dueToday: number
  mastered: number
  masteryRate: number
  streak: number
  heatmap: Record<string, number>
  weakChapters: {
    chapter_id: string
    title: string
    card_count: number
    lapse_rate: number
  }[]
  recent7: { day: string; reviewed: number; again: number }[]
}
