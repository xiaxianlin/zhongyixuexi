import { handle } from './registry'
import { getDashboard, getHeatmap } from '../services/learning'

/**
 * Learning IPC. The current UI exposes the learning dashboard only.
 */
export function registerLearningHandlers(): void {
  handle('learning:getDashboard', (_e, args: unknown) => {
    const { rangeDays } = (args ?? {}) as { rangeDays?: number }
    return getDashboard(rangeDays)
  })

  handle('learning:getHeatmap', (_e, args: unknown) => {
    const { year } = args as { year: number }
    return getHeatmap(year)
  })
}
