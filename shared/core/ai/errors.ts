/**
 * Fine-grained AI failure reasons, shared by desktop (electron/ai/errors.ts
 * wraps these in AppError for the IPC envelope) and server (routes/chat.ts
 * catches AiError directly over HTTP). Platform-neutral: no AppError/Fastify
 * coupling here.
 */
export type AiSubCode =
  | 'AI_KEY_NOT_CONFIGURED'
  | 'AI_STORAGE_UNAVAILABLE'
  | 'AI_AUTH_ERROR'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_TIMEOUT'
  | 'AI_SERVER_ERROR'
  | 'AI_REQUEST_FAILED'
  | 'AI_PARSE_ERROR'
  | 'AI_GUARD_BLOCKED'
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_UNKNOWN'

export class AiError extends Error {
  constructor(
    public readonly sub: AiSubCode,
    message: string,
  ) {
    super(message)
    this.name = 'AiError'
  }
}
