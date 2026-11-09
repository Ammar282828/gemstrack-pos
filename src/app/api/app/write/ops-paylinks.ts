/**
 * Payment links by Safepay (lib/writes/payment-links.ts; owner, 2026-11-09). Owners and the counter: a link only asks the
 * customer for money, and what comes in is recorded by the tick once Safepay says it was paid.
 *
 *   { op: 'createPaymentLink', target: 'invoice' | 'order', targetId, amount }
 *   → { ok: true, link: { id, url, amount, target, targetId } }
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { forgetSafepayKey, isSafepayPublicKey, paymentLinksOn } from '@/lib/safepay';
import { isSafepaySecret } from '@/lib/safepay-fees';
import { saveSafepaySecret, syncSafepayFees } from '@/lib/safepay-fees-server';
import { createPaymentLink } from '@/lib/writes/payment-links';
import { STORE_CONFIG } from '@/lib/store-config';
import type { OpHandler, OpRoles } from './op-context';

export const PAYLINK_OPS: OpRoles = {
  createPaymentLink: ['owner', 'staff'],
  // Settings → Integrations → Safepay: the house's PUBLIC key (Safepay's checkout takes it in the open). Owners only.
  setSafepayKey: ['owner'],
  // The SECRET key, for Safepay's fees and tax report only (lib/safepay-fees.ts): sealed server-side, never read back.
  setSafepaySecret: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Where the customer lands after paying: the house's website, else its ERP. */
const returnTo = () => process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || process.env.NEXT_PUBLIC_STORE_SHOP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://getsafepay.com';

export const runPaylinkOp: OpHandler = async (op, body, ctx) => {
  if (!(op in PAYLINK_OPS)) return null;
  if (op === 'setSafepayKey') {
    const key = typeof body.publicKey === 'string' ? body.publicKey.trim() : '';
    if (key && !isSafepayPublicKey(key)) return bad('That is not a Safepay public key (it starts with sec_). Use the Public key, not the Secret key.');
    await adminDb.collection('app_settings').doc('global').set({ safepayPublicKey: key || FieldValue.delete() }, { merge: true });
    forgetSafepayKey();
    await ctx.log('settings.update', key ? 'Safepay connected' : 'Safepay disconnected', key ? 'Payment links on' : 'Payment links off');
    return NextResponse.json({ ok: true, paymentLinks: !!key });
  }
  if (op === 'setSafepaySecret') {
    const secret = typeof body.secret === 'string' ? body.secret.trim() : '';
    if (secret && !isSafepaySecret(secret)) return bad('That is not a Safepay secret key (64 letters and digits, from Developer → API → Secret key).');
    await saveSafepaySecret(secret);
    await ctx.log('settings.update', secret ? 'Safepay fees report connected' : 'Safepay fees report disconnected', secret ? 'Fees and tax recorded monthly as expenses' : '');
    // The first run straight away, so the past months are in the books now.
    const run = secret ? await syncSafepayFees(new Date(), true).catch(e => ({ error: e instanceof Error ? e.message : String(e) })) : null;
    if (run && 'error' in run) return bad(`Saved, but Safepay refused the key: ${run.error}`, 502);
    return NextResponse.json({ ok: true, fees: !!secret, ...(run ? { run } : {}) });
  }
  if (!(await paymentLinksOn())) return bad(`${STORE_CONFIG.name} has no Safepay account connected.`);
  const target = body.target === 'order' ? 'order' : body.target === 'invoice' ? 'invoice' : null;
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!target || !targetId || targetId.length > 200 || targetId.includes('/')) return bad('Which invoice or order?');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 50_000_000) return bad('The amount must be at least 1 rupee.');
  try {
    const link = await createPaymentLink(adminPort, { target, targetId, amount, by: ctx.email, returnTo: returnTo() });
    await ctx.log(`${target}.update`, `Payment link for ${target} ${targetId}`, `PKR ${link.amount.toLocaleString()} by Safepay`, targetId);
    return NextResponse.json({ ok: true, link: { id: link.id, url: link.url, amount: link.amount, target, targetId } });
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'Safepay did not make the link.', 502);
  }
};
