/**
 * The last of Settings native on the phone: the website's selling settings (lib/writes/website-config.ts),
 * the shop's defaults put back (the Data page's "Restore shop defaults") and the document numbering
 * (lib/writes/counters.ts). Each runs its shared write on the Admin SDK.
 *
 * Owners only: these are the owners' settings pages (roles.ts).
 *
 * - Numbering asks for the delete code: a counter moved back numbers the next sale like a bill already
 *   printed. Nothing to change is said before the code is asked for, so no try is spent on it.
 * - Restore shop defaults writes this house's own name, address and number (STORE_CONFIG, only those it has),
 *   and for a gold house gold.pk's gold through setRates, which stamps and logs the rates as the rate sheet
 *   does. `preview: true` answers what it would write and writes nothing, for the phone's confirmation.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { personFor } from '@/lib/people';
import { mainRate } from '@/lib/rates';
import { STORE_CONFIG } from '@/lib/store-config';
import { cleanRates, setRates } from '@/lib/writes/rates';
import { cleanSettingsPatch } from '@/lib/writes/settings';
import { cleanWebsiteConfig, setWebsiteConfig } from '@/lib/writes/website-config';
import { cleanCounters, countersMoving, setCounters } from '@/lib/writes/counters';
import { GET as goldPkRates } from '@/app/api/gold-rates/route';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const SETTINGS3_OPS: OpRoles = {
  saveWebsiteConfig: ['owner'],
  restoreShopDefaults: ['owner'],
  setCounters: ['owner'],
};

export const RESTORE_DEFAULTS_SOURCE = 'Restore shop defaults (gold.pk)';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** This house's own details, and only those it has: a blank one is left alone rather than erasing what the shop typed. */
export function shopDefaults(config: { name: string; address?: string; contact1Number?: string } = STORE_CONFIG): Record<string, string> {
  return {
    shopName: config.name,
    ...(config.address && { shopAddress: config.address }),
    ...(config.contact1Number && { shopContact: config.contact1Number.replace(/\s+/g, '') }),
  };
}

/** gold.pk's gold per gram, as the page's button reads it (/api/gold-rates); null when gold.pk does not answer. */
async function goldPk(): Promise<Record<string, number> | null> {
  try {
    const res = await goldPkRates();
    if (!res.ok) return null;
    const r = cleanRates((await res.json()) as Record<string, unknown>);
    if (!r.goldRatePerGram21k) return null;
    const out: Record<string, number> = {};
    for (const k of ['goldRatePerGram24k', 'goldRatePerGram22k', 'goldRatePerGram21k', 'goldRatePerGram18k'] as const) {
      if (r[k]) out[k] = r[k] as number;
    }
    return out;
  } catch {
    return null;
  }
}

export const runSettings3Op: OpHandler = async (op, body, ctx) => {
  const by = personFor(ctx.email) || ctx.email;
  switch (op) {
    case 'saveWebsiteConfig': {
      const cleaned = cleanWebsiteConfig(body.config);
      if (!cleaned.ok) return bad(cleaned.error);
      const out = await setWebsiteConfig(adminPort, cleaned.config, { by }, { log: ctx.log });
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }

    case 'restoreShopDefaults': {
      const shop = cleanSettingsPatch(shopDefaults());
      if (!shop.ok) return bad(shop.error, 500);
      const gold = STORE_CONFIG.defaultMetal === 'gold';
      const rates = gold ? await goldPk() : null;
      const said = { shop: shop.patch, rates, gold, source: RESTORE_DEFAULTS_SOURCE };
      if (body.preview === true) return NextResponse.json({ ok: true, preview: true, ...said, followUps: ctx.followUps });

      await adminDb.collection('app_settings').doc('global').set(shop.patch, { merge: true });
      await ctx.log('settings.update', 'Shop defaults restored', `${Object.keys(shop.patch).join(', ')} · by ${by}`);
      const set = rates
        ? await setRates(adminPort, { rates, by, mainKey: mainRate(STORE_CONFIG.defaultMetal).key, source: RESTORE_DEFAULTS_SOURCE }, { log: ctx.log })
        : null;
      return NextResponse.json({ ok: true, ...said, ratesMoved: set?.moved ?? [], followUps: ctx.followUps });
    }

    case 'setCounters': {
      const cleaned = cleanCounters(body.counters);
      if (!cleaned.ok) return bad(cleaned.error);
      const current = await adminPort.get<Record<string, unknown>>('app_settings', 'global');
      if (!countersMoving(current, cleaned.counters).length) {
        return NextResponse.json({ ok: true, moved: [], before: {}, after: {}, followUps: ctx.followUps });
      }
      const code = await passDeleteCode(ctx.email, body.deleteCode, 'Change document numbering');
      if (!code.ok) return bad(code.error, code.status);
      const out = await setCounters(adminPort, cleaned.counters, { by }, { log: ctx.log });
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }
  }
  return null;
};
