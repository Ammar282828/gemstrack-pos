/**
 * Shopify orders created since a date that the ERP has no invoice for, and (with --apply) import them
 * through the same function the orders notice uses (mirrorShopifyOrderById with importIfAbsent).
 *
 *   npx tsx --env-file=.env.mina.local scripts/shopify-missing-orders.ts --since 2026-10-09          # list
 *   npx tsx --env-file=.env.mina.local scripts/shopify-missing-orders.ts --since 2026-10-09 --apply  # import
 *
 * Prints order name, date, total, status; never names, phones or addresses.
 */
import { adminDb } from '@/lib/firebase-admin';
import { isPosPushedOrder } from '@/lib/shopify-mirror';
import { getShopifyCredentials, shopifyRequest } from '../src/app/api/shopify/_lib';
import { mirrorShopifyOrderById, SINCE_ORDER_NUMBER } from '../src/app/api/shopify/_order-mirror';

const apply = process.argv.includes('--apply');
const since = process.argv[process.argv.indexOf('--since') + 1] || '2026-10-09';

async function main() {
  const { shop, token } = await getShopifyCredentials(adminDb);
  const r = await shopifyRequest(shop, token, 'GET', `/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(new Date(since).toISOString())}&fields=id,name,order_number,created_at,total_price,currency,financial_status,fulfillment_status,cancelled_at,tags,note`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orders: any[] = r?.orders || [];
  console.log(`${orders.length} Shopify orders since ${since} · ${apply ? 'APPLYING' : 'dry run'}`);
  let missing = 0;
  for (const o of orders) {
    const byDoc = (await adminDb.collection('invoices').doc(`SHOPIFY-${o.order_number}`).get()).exists;
    const byId = !byDoc && !(await adminDb.collection('invoices').where('shopifyOrderId', '==', String(o.id)).limit(1).get()).empty;
    if (byDoc || byId) continue;
    const why = isPosPushedOrder(o) ? 'ERP-pushed, skipped' : Number(o.order_number) <= SINCE_ORDER_NUMBER ? 'below cutoff' : /POS Invoice INV-/.test(o.note || '') ? 'checkout link' : 'MISSING';
    console.log(`${o.name} · ${String(o.created_at).slice(0, 16)} · ${o.currency} ${o.total_price} · ${o.financial_status}/${o.fulfillment_status || 'unfulfilled'}${o.cancelled_at ? ' · cancelled' : ''} · ${why}`);
    if (why !== 'MISSING') continue;
    missing++;
    if (apply) {
      const out = await mirrorShopifyOrderById(shop, token, String(o.id), { importIfAbsent: true });
      const inv = (await adminDb.collection('invoices').doc(`SHOPIFY-${o.order_number}`).get()).data();
      console.log(`  → ${'skipped' in out ? 'skipped: ' + out.skipped : 'imported=' + !!out.imported} · invoice SHOPIFY-${o.order_number}: ${inv ? `total ${inv.grandTotal}, paid ${inv.amountPaid}, owes ${inv.balanceDue}, ${inv.shopifyFinancialStatus}/${inv.shopifyFulfillment}, status ${inv.status ?? 'n/a'}` : 'NOT FOUND'}`);
    }
  }
  console.log(`${missing} missing`);
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
