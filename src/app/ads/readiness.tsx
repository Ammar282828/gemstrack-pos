'use client';

/**
 * What still stands between the shop and running every kind of ad, in one strip at the top of
 * the Overview: the Meta app not Live (new photo ads refused), permissions the login lacks, and
 * the website pixel. Only what is missing is shown; each line says where to fix it.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { PixelState } from '@/lib/ads/pixel';
import { STORE_LINKS } from '@/lib/store-config';
import { api, type AdsStatus } from './ads-kit';

/** A site the house sells from: its website or its online shop. */
const SITE = !!(STORE_LINKS.website || STORE_LINKS.shop);

export function Readiness({ status }: { status: AdsStatus }) {
  const [pixel, setPixel] = useState<PixelState | null>(null);
  const ready = !!status.connection?.connected && !!status.settings?.adAccountId;
  useEffect(() => { if (ready && SITE) api<{ state: PixelState }>('/api/ads/pixel').then(d => setPixel(d.state)).catch(() => undefined); }, [ready]);
  if (!ready) return null;
  const items: { text: string; href: string }[] = [];
  const live = status.app.live;
  if (live && (!live.privacyPolicyUrl || !live.category || !live.icon)) {
    items.push({ text: 'The Meta app is still in Development: new ads from new photos are refused (boosting a post works). Fill privacy policy, category and icon, then switch it Live.', href: '/ads/setup' });
  }
  // The login can't be kept (2026-10-04 audit: Setup's step 2 said so, in red, below the fold): a user login
  // then lapses at its expiry and every Ads page stops — reconnecting is the only remedy until it is granted.
  if (!status.app.tokenStore.write) items.push({ text: `This ERP can’t save the Meta login (${status.app.tokenSecret}): grant the App Hosting account Secret Version Adder on it — until then, connect again before each login runs out.`, href: '/ads/setup' });
  const missing = status.connection?.missingScopes ?? [];
  if (missing.length) items.push({ text: `The Facebook login lacks ${missing.join(', ')} — add ${missing.length === 1 ? 'it' : 'them'} to the login configuration and connect again.`, href: '/ads/setup' });
  if (SITE && pixel && !pixel.live) {
    const carried = [...new Set(pixel.sites.flatMap(x => x.ids ?? []))];
    items.push({
      text: pixel.id ? 'The website pixel hasn’t fired this week — the site isn’t loading it yet.'
        : carried.length ? `The shop’s site already carries a Meta pixel (${carried.join(', ')}) but ads don’t use it yet — choose it on Setup: website ads then buy page views and orders, and visitors can be retargeted.`
        : 'No website pixel: website ads buy clicks only, and visitors can’t be retargeted.',
      href: '/ads/setup',
    });
  }
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 space-y-1.5">
      <p className="text-sm font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 text-warning" /> Before every kind of ad can run</p>
      <ul className="space-y-1">
        {items.map(i => (
          <li key={i.text}><Link href={i.href} className="flex items-start gap-1.5 text-xs hover:text-primary"><ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span>{i.text}</span></Link></li>
        ))}
      </ul>
    </div>
  );
}
