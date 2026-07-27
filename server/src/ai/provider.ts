import type { ProviderConfig } from './types'

/** The single platform-held DeepSeek credential — no per-user BYOK (proposal §4/§7). */
export function getProviderConfig(): ProviderConfig {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set')
  return {
    provider: 'deepseek',
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    apiKey,
  }
}
