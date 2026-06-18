/**
 * Learning domain renderer IPC client — learning:* channels (LRN module,
 * converged to a reading-footprint dashboard).
 *
 * Unwraps the {__ok} envelope via models/shared/ipc.ts. Mirrors the channel
 * registered in electron/ipc/learning.ts.
 */
import { invokeRaw } from '@/models/shared/ipc'
import type { DashboardDTO } from './types'

/** learning:* — dashboard-only renderer API. */
export const learningApi = {
  getDashboard: () => invokeRaw<DashboardDTO>('learning:getDashboard'),
}
