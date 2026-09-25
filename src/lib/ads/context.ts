/**
 * What a new ad needs to know about this house before it can be built: the
 * ad account, its currency and smallest daily budget, the Page and Instagram
 * account ads run as, the WhatsApp greeting.
 *
 * Server-only.
 */

import { graph } from './meta';
import { requireAccount } from './settings';
import { fromMinor } from './shape';
import type { PlanContext } from './plan';

export async function planContext(): Promise<{ act: string; ctx: PlanContext }> {
  const { act, settings } = await requireAccount();
  const a = await graph<{ currency?: string; min_daily_budget?: string | number }>(act, { params: { fields: 'currency,min_daily_budget' } });
  const currency = String(a.currency || 'PKR');
  return {
    act,
    ctx: {
      pageId: settings.pageId,
      instagramUserId: settings.instagramUserId,
      instagramUsername: settings.instagramUsername,
      whatsappGreeting: settings.whatsappGreeting,
      currency,
      minDaily: a.min_daily_budget ? fromMinor(a.min_daily_budget, currency) : null,
    },
  };
}
