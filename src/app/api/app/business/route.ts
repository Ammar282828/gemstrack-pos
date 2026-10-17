/**
 * GET: who this ERP is, for the one native app (bundle shop.taheri.erp) that switches between businesses at
 * run time and can add one by typing its ERP address. PUBLIC, no sign-in: the app asks before anyone has
 * signed in, and everything here is what the web already shows every visitor (name, colours, logo) or ships
 * inside the app (the iOS sign-in identifiers). Cacheable for five minutes. See docs/features/two-houses.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  STORE_BRAND, STORE_CONFIG, STORE_ICONS, STORE_LOGO_ASPECT, STORE_LOGO_LIGHT_URL, STORE_LOGO_URL, STORE_PALETTE,
  STORE_EST_MARGIN, storeAppIos,
} from '@/lib/store-config';
import { COST_RATTI_LESS } from '@/lib/margin';
import { shopFlags } from '@/lib/app-shop';

export const dynamic = 'force-dynamic';

/** The address the app was reached at (behind App Hosting's proxy, the forwarded host), https except on localhost. */
const originOf = (req: NextRequest): string => {
  const first = (v: string | null) => (v || '').split(',')[0].trim();
  const host = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host')) || req.nextUrl.host;
  const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(host);
  return `${local ? 'http' : 'https'}://${host}`;
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
    flags: shopFlags(),
  };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
