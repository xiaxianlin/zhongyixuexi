/** Settings DTOs for the fixed AI provider slots. */

export interface ProviderConfig {
  id: string
  provider: string
  label: string
  baseUrl: string
  model: string
  hasKey: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface SaveProviderInput {
  id?: string
  provider: string
  label: string
  baseUrl: string
  model: string
  /** Plaintext key (encrypted in main process); omit to keep existing. */
  apiKey?: string | null
}
