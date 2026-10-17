/** The Meta business that owns this house's ad account: catalogues, partnership content and A/B tests live there. Server-only. */

import { graph, MetaAdsError } from './meta';

export async function businessOf(act: string): Promise<string> {
  const d = await graph<{ business?: { id?: string } }>(act, { params: { fields: 'business{id}' } });
  if (!d.business?.id) throw new MetaAdsError('The ad account isn’t in a Meta business, which this needs (Business Settings → Accounts → Ad accounts).', 409);
  return d.business.id;
}
