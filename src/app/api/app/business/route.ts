/**
 * GET: who this ERP is, for the one native app (bundle shop.taheri.erp) that switches between businesses at
 * run time and can add one by typing its ERP address. PUBLIC, no sign-in: the app asks before anyone has
 * signed in, and everything here is what the web already shows every visitor (name, colours, logo) or ships
 * inside the app (the iOS sign-in identifiers). Cacheable for five minutes. See docs/features/two-houses.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  STORE_BRAND, STORE_CONFIG, STORE_ICONS, STORE_LOGO_ASPECT, STORE_LOGO_LIGHT_URL, STORE_LOGO_URL, STORE_PALETTE,
  STORE_EST_MARGIN, storeAppIos, storeAppAndroid,
} from '@/lib/store-config';
import { COST_RATTI_LESS } from '@/lib/margin';
import { shopFlags } from '@/lib/app-shop';

export const dynamic = 'force-dynamic';

/**
 * The ERP's address. From configuration (NEXT_PUBLIC_APP_URL), not from a header: this answer is cached and the
 * app then talks to its serverURL with the user's token, so a forged Host must not choose it. Each house is
 * reached at both erp.* and pos.* (the app checks that the descriptor's host is the one typed), so the request's
 * host is honoured only when it is one of those two; anything else gets the configured address. With no
 * configured address (local dev) the request's host is used, as before.
 */
const originOf = (req: NextRequest): string => {
  const first = (v: string | null) => (v || '').split(',')[0].trim().toLowerCase();
  const reqHost = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host')) || req.nextUrl.host;
  let configured: URL | null = null;
  try { configured = STORE_CONFIG.appUrl ? new URL(STORE_CONFIG.appUrl) : null; } catch { configured = null; }
  if (configured) {
    const h = configured.host.toLowerCase();
    const twin = h.replace(/^(erp|pos)\./, (_, p: string) => (p === 'erp' ? 'pos.' : 'erp.'));
    return reqHost === twin ? `https://${twin}` : `${configured.protocol}//${configured.host}`;
  }
  const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(reqHost);
  return `${local ? 'http' : 'https'}://${reqHost}`;
};

export async function GET(req: NextRequest) {
  const origin = originOf(req);
  const abs = (p: string) => (/^https?:\/\//i.test(p) ? p : `${origin}${p.startsWith('/') ? '' : '/'}${p}`);
  const body = {
    version: 1,
    id: STORE_BRAND,
    name: STORE_CONFIG.name,
    shortName: STORE_ICONS.short,
    serverURL: origin,
    metal: STORE_CONFIG.defaultMetal,
    margin: COST_RATTI_LESS !== null
      ? { kind: 'rattiLess', ratti: COST_RATTI_LESS }
      : { kind: 'percent', percent: Math.round(STORE_EST_MARGIN * 100) },
    palette: STORE_PALETTE,
    logo: { light: abs(STORE_LOGO_URL), dark: abs(STORE_LOGO_LIGHT_URL), aspect: STORE_LOGO_ASPECT },
    icon: abs(`${STORE_ICONS.dir}/icon-512.png`),
    ios: storeAppIos(),
    // The Android app's sign-in; null until this house has registered shop.taheri.erp in its Firebase project.
    android: storeAppAndroid(),
    flags: shopFlags(),
    // The oldest app build this ERP takes (APP_MIN_BUILD, a CFBundleVersion number); 0: any. The app says "Update from TestFlight" below it.
    minBuild: Math.max(0, Math.floor(Number(process.env.APP_MIN_BUILD) || 0)),
    // The same for the Android app (APP_MIN_ANDROID_BUILD, a versionCode): the two stores number their builds apart, so one floor
    // could not serve both. 0: any.
    minAndroidBuild: Math.max(0, Math.floor(Number(process.env.APP_MIN_ANDROID_BUILD) || 0)),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
