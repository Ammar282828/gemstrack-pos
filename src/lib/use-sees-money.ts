'use client';

/**
 * Whether the signed-in person may see an amount outside the one bill in hand (docs/decisions.md#staff-see-no-money).
 * Owners only: staff, with or without marketing, see prices on the invoice or order they are making or have open, and
 * nothing that sums or lists money. A dev preview as staff (`?as=staff`) counts as staff, as in use-can-discount.ts.
 *
 * This is presentation. The server's staff read path still sends each invoice and order its totals (the bill in hand
 * needs them); what it withholds is roles.ts's STAFF_HIDDEN_FIELDS. Ads and Insights are stripped in the routes themselves.
 */

import { useAuth } from '@/components/auth/google-auth-gate';
import { seesMoney, spendHidden } from '@/lib/roles';
import { devRole } from '@/lib/dev-role';

export function useSeesMoney(): boolean {
  const { user } = useAuth();
  return devRole() ? false : seesMoney(user?.email);
}

/** The opposite, named for the places that read better asking it. */
export const useMoneyBlind = (): boolean => !useSeesMoney();

/**
 * The staff member who also runs the marketing: Ads and Insights show her no spend, budget, cost per result, ROAS or
 * sales figure, and her new ads wait paused for an owner to budget (lib/ads/spend.ts holds the server's half).
 */
export function useSpendHidden(): boolean {
  const { user } = useAuth();
  return !devRole() && spendHidden(user?.email);
}
