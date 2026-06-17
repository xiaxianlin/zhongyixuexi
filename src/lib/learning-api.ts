/**
 * Typed renderer-side client for `learning:*` channels (LRN module).
 *
 * Lives in its own file (per dev-lrn.md ownership) so the learning surface is
 * self-contained; src/lib/ipc.ts stays untouched. The unwrap follows the same
 * {__ok} envelope + IpcError contract as src/lib/ipc.ts (re-declared locally
 * to avoid editing the shared file).
 */

import { IpcError, type SerializedError } from './ipc'
import type { DashboardDTO } from '@/modules/learning/types'

type IpcResult<T> = { __ok: true; data: T } | { __ok: false; error: SerializedError }

async function invokeRaw<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.api) {
    throw new IpcError({ code: 'UNKNOWN', message: 'API bridge unavailable' })
  }
  const result = (await window.api.invoke(channel, ...args)) as IpcResult<T>
  if (!result.__ok) throw new IpcError(result.error)
  return result.data
}

/** learning:* — dashboard-only renderer API. */
export const learningApi = {
  getDashboard: (rangeDays?: number) =>
    invokeRaw<DashboardDTO>('learning:getDashboard', { rangeDays }),
  getHeatmap: (year: number) =>
    invokeRaw<Record<string, number>>('learning:getHeatmap', { year }),
}
