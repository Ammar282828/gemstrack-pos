/**
 * GET → this house's automated rules (and the recent log of changes made from the POS).
 * POST { kind, amount }            → a new rule (src/lib/ads/rules.ts)
 * POST { id, enabled }             → on / off
 * DELETE ?id=                      → gone
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graph } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { createRule, deleteRule, listRules, setRule, RULE_KINDS, type RuleKind } from '@/lib/ads/rules';
import { logAds, recentAdsLog } from '@/lib/ads/log';

export const dynamic = 'force-dynamic';

async function currencyOf(act: string) {
  return String((await graph<{ currency?: string }>(act, { params: { fields: 'currency' } })).currency || 'PKR');
}

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const { act } = await requireAccount();
    const currency = await currencyOf(act);
    const [rules, log] = await Promise.all([
      listRules(act, currency),
      recentAdsLog(40).catch(() => []),
    ]);
    return NextResponse.json({ rules, kinds: RULE_KINDS, currency, log }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'rules');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const b = (await req.json().catch(() => ({}))) as { kind?: string; amount?: number; id?: string; enabled?: boolean };
  try {
    const { act } = await requireAccount();
    if (b.id) {
      await setRule(act, b.id, !!b.enabled);
      await logAds({ by: who, action: b.enabled ? 'rule on' : 'rule off', target: b.id });
      return NextResponse.json({ ok: true });
    }
    if (!RULE_KINDS.some(k => k.key === b.kind)) return NextResponse.json({ error: 'What kind of rule?' }, { status: 400 });
    const made = await createRule(act, b.kind as RuleKind, Number(b.amount), await currencyOf(act));
    await logAds({ by: who, action: 'rule made', target: made.id, detail: { kind: b.kind, amount: b.amount } });
    return NextResponse.json({ ok: true, ...made });
  } catch (e) {
    return adsFail(e, 'rule');
  }
}

export async function DELETE(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id') || '';
  try {
    const { act } = await requireAccount();
    await deleteRule(act, id);
    await logAds({ by: who, action: 'rule deleted', target: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return adsFail(e, 'rule delete');
  }
}
