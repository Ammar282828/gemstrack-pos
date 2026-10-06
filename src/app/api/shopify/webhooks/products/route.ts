import { NextResponse } from 'next/server';

/**
 * products/create: nothing to do. Stock is the ERP's own; a website piece comes in through
 * Settings → Shopify (the pull), one sized variant at a time. This handler used to make a stock row
 * for every variant of every new Shopify product — the Birthstone Stack alone has 1,824 — and it
 * never ran: every Shopify notice was refused until 2026-10-06 (webhooks/orders/route.ts), and the
 * ERP holds no SHOPIFY-PROD- stock.
 */
export async function POST() {
  return NextResponse.json({ ok: true, skipped: 'products-are-pulled' });
}
