/**
 * AI service (v3.1 chapter-level model).
 *
 * Currently exposes only status() — whether a provider key is configured (no
 * plaintext returned). Chapter-level analysis generation (解读 / 医理 / 白话)
 * and chat are added in slices D4 / D5; the low-level DeepSeek client, prompt
 * builders, cache, and guard in electron/ai/* are reused then.
 *
 * The plaintext API key is obtained via getActiveApiKey() (SET module), lives
 * only in local consts for the duration of a call, and is never logged or
 * returned. Key-absence throws aiError('AI_KEY_NOT_CONFIGURED').
 */
import { getActiveApiKey } from './settings'
import type { ProviderConfig } from '../ai/types'
import { aiError } from '../ai/errors'

export interface AiStatusDTO {
  configured: boolean
  provider: string | null
  model: string | null
}

/**
 * Load the active provider config (plaintext key, main-process only).
 * Throws AI_KEY_NOT_CONFIGURED when no key is set so the renderer can degrade.
 */
export function loadConfig(): ProviderConfig {
  const cfg = getActiveApiKey()
  if (!cfg || !cfg.apiKey) {
    throw aiError('AI_KEY_NOT_CONFIGURED', '未配置 API Key，请在设置中添加')
  }
  return cfg
}

/** Whether a key is configured — never returns the plaintext. */
export function status(): AiStatusDTO {
  const cfg = getActiveApiKey()
  if (!cfg || !cfg.apiKey) return { configured: false, provider: null, model: null }
  return { configured: true, provider: cfg.provider, model: cfg.model }
}
