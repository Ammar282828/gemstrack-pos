import { NextResponse } from 'next/server';

/**
 * customers/create and customers/update: nothing to do. Who from the website becomes a customer in
 * the ERP is chosen in Settings → Shopify (the pull), and an imported customer is the shop's record
 * from then on. This handler used to write every Shopify sign-up into the customers list and
 * overwrite an imported one's name, phone and address with Shopify's; it never ran — every Shopify
 * notice was refused until 2026-10-06 (webhooks/orders/route.ts) — and the shop has been choosing
 * by hand since.
 */
export async function POST() {
  return NextResponse.json({ ok: true, skipped: 'customers-are-pulled' });
}
