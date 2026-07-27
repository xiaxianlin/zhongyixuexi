export interface InviteCodeRecord {
  maxUses: number | null
  useCount: number
  revokedAt: Date | null
}

/** Pure eligibility check — kept separate from the DB row shape so it's unit-testable. */
export function canUseInviteCode(code: InviteCodeRecord, now: Date = new Date()): boolean {
  if (code.revokedAt && code.revokedAt <= now) return false
  if (code.maxUses !== null && code.useCount >= code.maxUses) return false
  return true
}
