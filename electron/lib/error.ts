export type ErrorCode =
  | 'DB'
  | 'PARSE'
  | 'IO'
  | 'AI'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNKNOWN'

export interface SerializedError {
  code: ErrorCode
  message: string
  details?: unknown
}

/** Structured error that safely crosses the IPC boundary. */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  serialize(): SerializedError {
    return { code: this.code, message: this.message, details: this.details }
  }
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof AppError) return err.serialize()
  if (err instanceof Error) return { code: 'UNKNOWN', message: err.message }
  return { code: 'UNKNOWN', message: String(err) }
}
