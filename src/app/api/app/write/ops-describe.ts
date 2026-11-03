/**
 * The saved stone combinations that complete a piece's description (owner, 2026-11-03).
 *
 *   setStoneCombos { combos: string[] }  -> app_settings/global.stoneCombos
 *
 * Owners and staff (the counter adds a combination as it meets one). At most 200, each at most 60 characters,
 * trimmed and de-duplicated; the list sent replaces the one kept.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { cleanCombos } from '@/lib/describe';
import { forgetDescribeHistory } from '@/lib/describe-server';
import type { OpHandler, OpRoles } from './op-context';

export const DESCRIBE_OPS: OpRoles = {
  setStoneCombos: ['owner', 'staff'],
};

export const runDescribeOp: OpHandler = async (op, body, ctx) => {
  if (op !== 'setStoneCombos') return null;
  const r = cleanCombos(body.combos);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  await adminDb.collection('app_settings').doc('global').set({ stoneCombos: r.combos }, { merge: true });
  forgetDescribeHistory();
  await ctx.log('settings.update', 'Stone combinations', `${r.combos.length} saved`);
  return NextResponse.json({ ok: true, combos: r.combos, followUps: ctx.followUps });
};
