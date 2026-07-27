/** Fine-grained AI failure reasons — ported from electron/ai/errors.ts, standalone (no AppError coupling here). */
export type AiSubCode =
  | 'AI_KEY_NOT_CONFIGURED'
  | 'AI_AUTH_ERROR'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_TIMEOUT'
  | 'AI_SERVER_ERROR'
  | 'AI_REQUEST_FAILED'
  | 'AI_UNKNOWN'

export class AiError extends Error {
  constructor(
    public readonly sub: AiSubCode,
    message: string,
  ) {
    super(message)
  }
}
