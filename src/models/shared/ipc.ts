/**
 * Shared IPC base — the {__ok} envelope unwrap + structured IpcError.
 *
 * Every domain api (models/<domain>/api.ts) imports `invokeRaw` from here.
 * Renderer code never calls window.api.invoke directly; it goes through a
 * typed domain api wrapper, which in turn calls invokeRaw.
 */

/** Fields serialized across IPC from electron/lib/error.ts AppError. */
export interface SerializedError {
  code: string
  message: string
  details?: unknown
  stack?: string
}

/** IPC envelope shape returned by every registry.handle() in the main process. */
type IpcResult<T> = { __ok: true; data: T } | { __ok: false; error: SerializedError }

/**
 * Error thrown by invokeRaw when the main-process handler returns
 * {__ok:false}. Carries the structured code/details so callers can branch.
 */
export class IpcError extends Error {
  code: string
  details?: unknown
  stack?: string

  constructor(serialized: SerializedError) {
    super(serialized.message)
    this.name = 'IpcError'
    this.code = serialized.code
    this.details = serialized.details
    this.stack = serialized.stack
  }
}

/**
 * Invoke an IPC channel and unwrap the {__ok} envelope. Throws IpcError on
 * failure (with .code / .details). This is the single renderer→main boundary.
 */
export async function invokeRaw<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.api) {
    throw new IpcError({ code: 'UNKNOWN', message: 'API bridge unavailable' })
  }
  const result = (await window.api.invoke(channel, ...args)) as IpcResult<T>
  if (!result.__ok) throw new IpcError(result.error)
  return result.data
}

/** Subscribe to a main→renderer event channel; returns an unsubscribe fn. */
export function onChannel<T>(channel: string, cb: (payload: T) => void): () => void {
  return window.api.on(channel, cb as (payload: unknown) => void)
}
