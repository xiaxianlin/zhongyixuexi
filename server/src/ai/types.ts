/** OpenAI-compatible chat types (DeepSeek's /chat/completions is a subset of this shape). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  response_format?: { type: 'json_object' }
}

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

/** Single platform-held credential — no BYOK; see proposal-online-membership-billing.md. */
export interface ProviderConfig {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
}
