/**
 * Bring every web order the ERP has pulled in up to Shopify's word — paid, shipped, cancelled —
 * by the same rule and code as the orders notice (app/api/shopify/_order-mirror.ts). For the month
 * and more when every notice was refused (found 2026-10-06), and any time notices may have been missed.
 *
 *   npx tsx --env-file=.env.mina.local scripts/shopify-mirror-orders.ts          # what would change
 *   npx tsx --env-file=.env.mina.local scripts/shopify-mirror-orders.ts --apply  # change it
 *
 * Prints invoice numbers and amounts, never names.
 */

import { adminDb } from '@/lib/firebase-admin';
import { planShopifyMirror } from '@/lib/shopify-mirror';
import { getShopifyCredentials } from '../src/app/api/shopify/_lib';
import { fetchShopifyOrder, fetchShopifyTransactions, invoiceForShopifyOrder, mirrorShopifyOrderById } from '../src/app/api/shopify/_order-mirror';

const apply = process.argv.includes('--apply');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pkr = (n: number) => Math.round(n).toLocaleString('en-PK');

async function main() {
  const { shop, token } = await getShopifyCredentials(adminDb);
  const snap = await adminDb.collection('invoices').where('source', '==', 'shopify').get();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const invoices: Record<string, any>[] = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Record<string, any>)
    .filter(i => i.shopifyOrderId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  console.log(`${invoices.length} pulled web orders · ${apply ? 'APPLYING' : 'dry run'}`);

  let changed = 0, paidOff = 0, documented = 0, cancelled = 0, added = 0, shipped = 0, owedBefore = 0, owedAfter = 0;
  for (const inv of invoices) {
    await sleep(1100); // two calls an order; Shopify's REST allowance is two a second
    const order = await fetchShopifyOrder(shop, token, String(inv.shopifyOrderId));
    if (!order) { console.log(`${inv.id}: gone from Shopify`); continue; }
    const target = await invoiceForShopifyOrder(order);
    if ('skipped' in target || target.invoiceId !== inv.id) { console.log(`${inv.id}: skipped (${'skipped' in target ? target.skipped : 'maps to ' + target.invoiceId})`); continue; }
    const txs = await fetchShopifyTransactions(shop, token, String(order.id));
    const plan = planShopifyMirror(inv, order, txs, { voidWhenCancelled: target.webSale });
    const due = Number(inv.balanceDue) || 0;
    owedBefore += Math.max(0, due);
    owedAfter += Math.max(0, plan.added.length ? plan.balanceDue : due);
    if (!plan.changed) continue;
    changed++;
    const notes: string[] = [];
    if (plan.added.length) {
      added += plan.added.reduce((s, p) => s + p.amount, 0);
      if (due > 0.5 && plan.balanceDue <= 0.5) paidOff++;
      if (due <= 0.5) documented++; // paid already, now with the payment that paid it
      notes.push(`+${plan.added.map(p => `${pkr(p.amount)} ${p.method || 'method?'} ${p.date.slice(0, 10)}`).join(', ')} → owes ${pkr(plan.balanceDue)}`);
    }
    if (plan.fields.shopifyFulfillment !== (inv.shopifyFulfillment || '')) {
      notes.push(`${inv.shopifyFulfillment || '—'} → ${plan.fields.shopifyFulfillment}`);
      if (plan.fields.shopifyFulfillment === 'fulfilled') shipped++;
    }
    if (plan.fields.shopifyFinancialStatus !== (inv.shopifyFinancialStatus || '')) notes.push(`${inv.shopifyFinancialStatus || '—'} → ${plan.fields.shopifyFinancialStatus}`);
    if (plan.fields.shopifyCancelledAt && !inv.shopifyCancelledAt) { cancelled++; notes.push(`CANCELLED on Shopify ${plan.fields.shopifyCancelledAt.slice(0, 10)}, ERP owed ${pkr(due)}, paid ${pkr(Number(inv.amountPaid) || 0)}${plan.voids ? ' → voided' : ' → marked only'}`); }
    if (plan.voids) owedAfter -= Math.max(0, due);
    console.log(`${inv.id} (${String(inv.createdAt).slice(0, 10)}): ${notes.join(' · ') || 'payment ids only'}`);
    if (apply) {
      const out = await mirrorShopifyOrderById(shop, token, String(order.id));
      if ('skipped' in out) console.log(`  not written: ${out.skipped}`);
    }
  }
  console.log(`\n${changed} invoices ${apply ? 'updated' : 'would change'} · ${pkr(added)} in Shopify payments added · ${paidOff} owed → paid · ${documented} paid, now with their payment · ${shipped} now shipped · ${cancelled} cancelled on Shopify`);
  console.log(`owed on pulled web orders: ${pkr(owedBefore)} → ${pkr(owedAfter)}`);
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
