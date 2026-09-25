/**
 * GET → everything the Ads pages need to know before they can do anything:
 * is the Meta app set up here, is a login connected (whose, until when, with
 * which permissions), which ad account / Page / Instagram this house uses, and
 * the ad account's own state (active? payment due? what's been spent?).
 *
 * Each part answers on its own — a missing secret or an expired login is a line
 * on the Setup tab, never a broken page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { appSecret, checkConnection, META_APP_ID, redirectUri, SCOPES, TOKEN_SECRET, APP_SECRET_NAME, GRAPH_VERSION } from '@/lib/ads/meta';
import { accountSummary, HOUSE_INSTAGRAM, loadAdsSettings, PINNED_ACCOUNT } from '@/lib/ads/settings';
import { secretAccess, secretConsoleUrl, posProject } from '@/lib/secret-manager';
import { publicOrigin } from '@/lib/social/gate';
import type { AdsAccount } from '@/lib/ads/shape';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;

  const [secret, store, checked, settings] = await Promise.all([
    appSecret().catch(() => null),
    secretAccess(TOKEN_SECRET()).catch(() => ({ exists: false, read: false, write: false })),
    checkConnection().catch(e => ({ error: e instanceof Error ? e.message : String(e) })),
    loadAdsSettings().catch(() => null),
  ]);

  let connection = null;
  if (checked && 'conn' in checked) {
    const { conn, valid, scopes, expiresAt, error } = checked;
    const daysLeft = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / 86_400_000) : null;
    connection = {
      connected: valid,
      kind: conn.kind,
      userName: conn.userName || null,
      connectedAt: conn.connectedAt || null,
      expiresAt,
      daysLeft,
      scopes,
      // A system user's token lists no scopes through us when there's no app secret to ask with; don't cry wolf then.
      missingScopes: scopes.length ? SCOPES.filter(s => !scopes.includes(s)) : [],
      error: error ?? null,
    };
  }
  const connectionError = checked && 'error' in checked && !('conn' in checked) ? checked.error : null;

  let account: AdsAccount | null = null;
  let accountError: string | null = null;
  if (connection?.connected && settings?.adAccountId) {
    try { account = await accountSummary(settings.adAccountId); } catch (e) { accountError = e instanceof Error ? e.message : String(e); }
  }

  return NextResponse.json({
    app: {
      id: META_APP_ID() || null,
      secret: !!secret,
      secretName: APP_SECRET_NAME(),
      secretUrl: secretConsoleUrl(APP_SECRET_NAME()),
      tokenSecret: TOKEN_SECRET(),
      tokenStore: store,
      tokenStoreUrl: secretConsoleUrl(TOKEN_SECRET()),
      project: posProject(),
      redirectUri: redirectUri(publicOrigin(req)),
      version: GRAPH_VERSION(),
    },
    connection,
    connectionError,
    settings,
    houseInstagram: HOUSE_INSTAGRAM() || null,
    pinnedAccount: !!PINNED_ACCOUNT(),
    account,
    accountError,
  }, { headers: noStore });
}
