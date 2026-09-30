/**
 * GET /api/shopify/status → whether this house has a Shopify store, and whether it answers.
 *
 * Settings' Shopify card was hardcoded to House of Mina's store and always said "Connected" —
 * on Taheri too, which has no Shopify at all (the audit of 2026-10-01). The card now shows only
 * where SHOPIFY_STORE_DOMAIN is set (apphosting.mina.yaml) and reads the store itself: its name,
 * the scopes the token holds, and how many of the ERP's webhooks point here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { erpUserOrCron } from '@/lib/erp-gate';
import { adminDb } from '@/lib/firebase-admin';
import { APP_URL, SHOPIFY_API_VERSION } from '../_lib';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await erpUserOrCron(req);
  if (denied) return denied;

  const shop = (process.env.SHOPIFY_STORE_DOMAIN || '').trim();
  if (!shop) return NextResponse.json({ configured: false });
  const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
  const settings = (await adminDb.collection('app_settings').doc('global').get().catch(() => null))?.data() || {};
  const base = { configured: true, shop, lastSyncedAt: settings.shopifyLastSyncedAt ?? null };
  if (!token) return NextResponse.json({ ...base, connected: false, error: 'No access token (SHOPIFY_ACCESS_TOKEN).' });

  const get = async (path: string) => {
    const res = await fetch(`https://${shop}/admin/${path}`, { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Shopify answered ${res.status} on ${path.split('?')[0]}`);
    return res.json();
  };
  try {
    const [shopInfo, scopes, hooks] = await Promise.all([
      get(`api/${SHOPIFY_API_VERSION}/shop.json?fields=name,myshopify_domain`),
      get('oauth/access_scopes.json').catch(() => null),
      get(`api/${SHOPIFY_API_VERSION}/webhooks.json`).catch(() => null),
    ]);
    const webhooks = (hooks?.webhooks || []) as { address: string }[];
    return NextResponse.json({
      ...base,
      connected: true,
      shopName: shopInfo?.shop?.name ?? null,
      scopes: ((scopes?.access_scopes || []) as { handle: string }[]).map(s => s.handle),
      webhooksHere: webhooks.filter(w => APP_URL && w.address.startsWith(APP_URL)).length,
      webhooksTotal: webhooks.length,
    });
  } catch (e) {
    return NextResponse.json({ ...base, connected: false, error: e instanceof Error ? e.message : String(e) });
  }
}
