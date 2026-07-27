/**
 * Access tier resolution (PRD §3.2 permission matrix): guest < free_member <
 * paid_member. The wallet lookup is injected rather than hard-wired to a real
 * `wallets` table because that table doesn't exist until S9.6 — routes gated
 * before then use the `NO_WALLET_YET` stub, which reads every member as a
 * free member until S9.6 swaps in the real balance query.
 */
export type AccessTier = 'guest' | 'free_member' | 'paid_member'

const TIER_RANK: Record<AccessTier, number> = {
  guest: 0,
  free_member: 1,
  paid_member: 2,
}

export function meetsTier(actual: AccessTier, required: AccessTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required]
}

export interface RequestActor {
  userId: string | null
  role: 'member' | 'admin' | null
}

export interface WalletBalanceLookup {
  getBalance(userId: string): Promise<number>
}

export const NO_WALLET_YET: WalletBalanceLookup = {
  getBalance: async () => 0,
}

export async function resolveAccessTier(
  actor: RequestActor,
  wallet: WalletBalanceLookup,
): Promise<AccessTier> {
  if (!actor.userId) return 'guest'
  if (actor.role === 'admin') return 'paid_member'
  const balance = await wallet.getBalance(actor.userId)
  return balance > 0 ? 'paid_member' : 'free_member'
}
