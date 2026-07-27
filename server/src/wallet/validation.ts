import { ValidationError } from '../lib/errors'

export interface AdjustmentInput {
  deltaTokens: number
  amountCny?: number | null
  note?: string | null
}

/** WALLET-02: a manual top-up/correction must move a non-zero whole number of tokens. */
export function validateAdjustmentInput(input: AdjustmentInput): void {
  if (!Number.isInteger(input.deltaTokens) || input.deltaTokens === 0) {
    throw new ValidationError('deltaTokens must be a non-zero integer')
  }
  if (input.amountCny !== undefined && input.amountCny !== null && input.amountCny < 0) {
    throw new ValidationError('amountCny cannot be negative')
  }
}
