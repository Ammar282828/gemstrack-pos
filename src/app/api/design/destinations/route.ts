/**
 * GET → where the Publish sheet can send a design, for this house and this person
 * (docs/features/design-studio-plan.md §5.3). One call in place of the three status calls the old
 * surfaces made (/api/instagram/status, /api/website/post, /api/website/photos), from configuration and the
 * stored Instagram connection only, so it answers fast and never reaches WhatsApp.
 *
 *   ?collections=1   also the website's collections (what GET /api/website/photos lists; a slow read)
 *   ?fromSite=1      the design came from a piece on the website, so "replace its photo" is offered
 *
 * Answers { facts, rows, collections? } — `facts` is the `DestinationFacts` (lib/design/destinations.ts), `rows`
 * the sheet's rows built from them (a destination the house or role lacks is `available: false` with its
 * reason). Staff get no Meta ad row; Mina has no channel, no set of the day and no Instagram connection.
 * Gated as the other Design routes (`designGate('post')`).
 */

import { NextRequest, NextResponse } from 'next/server';
import { designFail, designGate, mayUseAds, noStore } from '@/lib/design/gate';
import { destinationRows, type DestinationFacts } from '@/lib/design/destinations';
import { communityId, postChannel, postGroups } from '@/lib/social/destinations';
import { instagramConfigured, loadConnection } from '@/lib/social/instagram';
import { STORE_LINKS, STORE_META_ADS, STORE_SITE_EDIT, STORE_WEBSITE_FEATURED } from '@/lib/store-config';
import { GET as photosGet } from '@/app/api/website/photos/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function instagramFacts(): Promise<DestinationFacts['instagram']> {
  if (!instagramConfigured()) return { configured: false, connected: false, username: null };
  try {
    const c = await loadConnection();
    return { configured: true, connected: !!c && new Date(c.expiresAt).getTime() > Date.now(), username: c?.username ?? null };
  } catch {
    return { configured: true, connected: false, username: null };
  }
}

export async function GET(req: NextRequest) {
  const who = await designGate(req, 'post');
  if (who instanceof NextResponse) return who;
  try {
    const q = req.nextUrl.searchParams;
    const channel = postChannel();
    const facts: DestinationFacts = {
      mayAds: mayUseAds(who),
      metaAds: STORE_META_ADS,
      website: { on: !!STORE_LINKS.website, configured: !!process.env.WEBSITE_UPLOAD_SECRET },
      featured: STORE_WEBSITE_FEATURED,
      siteEdit: STORE_SITE_EDIT,
      whatsapp: { community: !!communityId(), groups: postGroups().map(g => ({ key: g.key, label: g.label })), channel: !!channel },
      instagram: await instagramFacts(),
    };
    let collections: unknown = undefined;
    if (q.get('collections') === '1' && facts.website.on && facts.website.configured) {
      const res = await photosGet(req);
      const d = await res.json().catch(() => null) as { collections?: unknown } | null;
      collections = res.ok ? d?.collections ?? [] : [];
    }
    return NextResponse.json({ facts, rows: destinationRows(facts, { fromSite: q.get('fromSite') === '1' }), ...(collections !== undefined ? { collections } : {}) }, { headers: noStore });
  } catch (e) {
    return designFail(e, 'destinations');
  }
}
