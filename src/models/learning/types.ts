/** Renderer-facing learning dashboard DTO (mirror of electron/services/learning.ts). */

export interface DashboardDTO {
  totalBooks: number
  totalChapters: number
  analyzedChapters: number
  analysisRate: number
  noteCount: number
  excerptCount: number
  activeReadingBooks: number
  totalReadSeconds: number
  heatmap: Record<string, number>
  recentBooks: {
    book_id: string
    title: string
    percent: number
    updated_at: number
  }[]
}
