import { NextResponse } from 'next/server';

/**
 * draft_orders/update: nothing to do. A checkout link's draft becomes an order when it is paid, and
 * the orders notice records that payment from Shopify's own transactions, once
 * (app/api/shopify/_order-mirror.ts). This handler used to record it too — the whole balance, with
 * no check it hadn't already — so one checkout could be paid twice or more on the invoice. It never
 * ran: every Shopify notice was refused until 2026-10-06 (webhooks/orders/route.ts).
 */
export async function POST() {
  return NextResponse.json({ ok: true, skipped: 'handled-by-orders' });
}
