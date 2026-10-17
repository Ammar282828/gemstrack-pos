'use client';

/**
 * Who may give a discount: the same role rule as the sidebar (app-layout.tsx) and the server's
 * updateInvoiceDiscount / Settle ops (owner-only). A dev preview as staff (`?as=staff`) counts as staff.
 */

import { useAuth } from '@/components/auth/google-auth-gate';
import { roleForEmail } from '@/lib/roles';
import { devRole } from '@/lib/dev-role';

export function useCanGiveDiscount(): boolean {
  const { user } = useAuth();
  return (devRole() ?? roleForEmail(user?.email)) === 'owner';
}
