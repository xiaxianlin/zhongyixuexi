/**
 * Shared types for the AI client layer (07-ai.md §6.1).
 *
 * DeepSeek's chat/completions endpoint is OpenAI-compatible, so these types
 * mirror the OpenAI Chat Completion request/response shape (subset we use).
 * Kept separate from any provider-specific client so swapping vendors later
 * (P2 image/TTS, or a non-DeepSeek text provider) only touches the client.
 */

/** Single chat message. role 'tool' is not used in this module. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Request body posted to `${baseUrl}/chat/completions`. */
export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  /** 0.3–0.5 for modern/cards, 0.5–0.7 for qa. Defaults per template. */
  temperature?: number
  max_tokens?: number
  /** DeepSeek/OpenAI JSON mode: forces a valid JSON object response. */
  response_format?: { type: 'json_object' }
  stream?: boolean
}

/** Response shape (subset). DeepSeek fills the OpenAI-compatible fields. */
export interface ChatResponse {
  id: string
  choices: {
    index: number
    message: ChatMessage
    finish_reason: string
  }[]
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface ChatStreamResult {
  id: string
  content: string
  finish_reason: string | null
  usage?: ChatResponse['usage']
}

/** Provider config obtained from getActiveApiKey() (main-process only). */
export interface ProviderConfig {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}
