import { handle } from './registry'
import { getDashboard } from '../services/learning'

/**
 * Learning IPC. The current UI exposes the learning dashboard only.
 */
export function registerLearningHandlers(): void {
  handle('learning:getDashboard', () => getDashboard())
}
