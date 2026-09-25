/**
 * GET  → the ad accounts, Facebook Pages and Instagram accounts the connected
 *        login can see (and whatever could be chosen automatically, chosen).
 * POST { adAccountId?, adAccountName?, pageId?, pageName?, instagramUserId?,
 *        instagramUsername?, whatsappGreeting? } → saved for this house.
 * POST { action: 'disconnect' } → forget the login (Meta still lists the app
 *        under the person's Business Integrations until they remove it there).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { disconnect } from '@/lib/ads/meta';
import { autoChoose, listAdAccounts, listInstagramAccounts, listPages, loadAdsSettings, saveAdsSettings, PINNED_ACCOUNT, HOUSE_INSTAGRAM, type AdsSettings } from '@/lib/ads/settings';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const current = await loadAdsSettings();
    const [accounts, pages] = await Promise.all([
      listAdAccounts(),
      listPages().catch(() => []),
    ]);
    const instagram = await listInstagramAccounts(current.adAccountId, pages);
    const settings = await autoChoose(current, accounts, pages, instagram);
    return NextResponse.json({
      accounts: PINNED_ACCOUNT() ? accounts.filter(a => a.id === PINNED_ACCOUNT()) : accounts,
      pages,
      instagram,
      settings,
      houseInstagram: HOUSE_INSTAGRAM() || null,
    }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'setup');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const body = (await req.json().catch(() => ({}))) as Partial<AdsSettings> & { action?: string };
  try {
    if (body.action === 'disconnect') {
      await disconnect();
      return NextResponse.json({ ok: true });
    }
    const patch: Partial<AdsSettings> = {};
    const str = (v: unknown, max = 200) => (v === null ? null : typeof v === 'string' ? v.trim().slice(0, max) || null : undefined);
    for (const k of ['adAccountId', 'adAccountName', 'pageId', 'pageName', 'instagramUserId', 'instagramUsername'] as const) {
      const v = str(body[k]);
      if (v !== undefined) patch[k] = v;
    }
    if (patch.adAccountId) patch.adAccountId = patch.adAccountId.replace(/^act_/, '');
    if (patch.adAccountId && !/^\d+$/.test(patch.adAccountId)) return NextResponse.json({ error: 'That is not an ad account id.' }, { status: 400 });
    const greeting = str(body.whatsappGreeting, 300);
    if (greeting !== undefined) patch.whatsappGreeting = greeting;
    return NextResponse.json({ settings: await saveAdsSettings(patch) });
  } catch (e) {
    return adsFail(e, 'setup save');
  }
}
