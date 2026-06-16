import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { serializeError, type SerializedError } from '../lib/error'

/**
 * Result envelope so structured errors reliably cross the IPC boundary
 * regardless of Electron's error-serialization quirks across versions.
 */
export type IpcResult<T> =
  | { __ok: true; data: T }
  | { __ok: false; error: SerializedError }

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>

/** Registers an ipcMain.handle that wraps the result in the IpcResult envelope. */
export function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const data = await fn(event, ...args)
      return { __ok: true, data } satisfies IpcResult<unknown>
    } catch (err) {
      return { __ok: false, error: serializeError(err) } satisfies IpcResult<never>
    }
  })
}
