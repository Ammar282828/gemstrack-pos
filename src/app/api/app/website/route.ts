/**
 * GET: what the iPhone app's Website screens need to know about this house (apps/iphone,
 * WebsiteKit.swift), as the web reads it from its build (lib/store-config.ts):
 *
 *   { site, siteName, featured, weights, edit, investments }
 *
 * `site` is the house's website (taheri.shop, the Mina catalogue), `featured` whether it has a set of
 * the day (STORE_WEBSITE_FEATURED: House of Mina's catalogue has none), `weights` Photo weights,
 * `edit` Edit a piece, `investments` Investments by Taheri. None is secret (the web ships them to every
 * browser). The menus already follow the flags (nav.ts → nav-<house>.json); the set of the day is not a
 * menu, which is why this exists. The same people as the website routes: owner, staff or marketing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { STORE_INVESTMENTS, STORE_LINKS, STORE_SITE_EDIT, STORE_WEBSITE_FEATURED, STORE_WEBSITE_WEIGHTS, STORE_POST_METAL, STORE_POST_TAGLINE, STORE_POST_FOOTER, STORE_WHATSAPP_NUMBERS } from '@/lib/store-config';
import { waNumberFromUrl } from '@/lib/social/caption';
import { siteNameOf } from '@/lib/website/site-name';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff' && role !== 'marketing') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const site = (STORE_LINKS.website || '').trim().replace(/\/+$/, '');
  return NextResponse.json({
    site,
    siteName: siteNameOf(site),
    posting: { metal: STORE_POST_METAL, tagline: STORE_POST_TAGLINE, footer: STORE_POST_FOOTER, whatsappNumbers: STORE_WHATSAPP_NUMBERS.length ? STORE_WHATSAPP_NUMBERS : [waNumberFromUrl(STORE_LINKS.whatsapp)].filter(Boolean), links: STORE_LINKS },
    featured: STORE_WEBSITE_FEATURED,
    weights: STORE_WEBSITE_WEIGHTS,
    edit: STORE_SITE_EDIT && !!site,
    investments: STORE_INVESTMENTS,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
