import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SCOPES = 'read_orders,write_orders,read_customers,write_customers,read_products,write_products,read_draft_orders,write_draft_orders';

export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get('shop');

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return NextResponse.json({ error: 'Invalid or missing shop parameter' }, { status: 400 });
  }

  // Only the connected shop may be (re)authorised; the first connection (none stored) goes through.
  const current = String((await adminDb.collection('app_settings').doc('global').get()).get('shopifyStoreDomain') || '').toLowerCase();
  if (current && current !== shop.toLowerCase()) {
    return NextResponse.json({ error: 'This ERP is connected to a different Shopify store.' }, { status: 403 });
  }

  if (!SHOPIFY_API_KEY) {
    return NextResponse.json({ error: 'SHOPIFY_API_KEY is not configured' }, { status: 500 });
  }

  const host = request.headers.get('host') || '';
  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const appUrl = isLocalhost ? `http://${host}` : `https://${host}`;
  const redirectUri = `${appUrl}/api/shopify/callback`;

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('shopify_oauth_state', state, { httpOnly: true, secure: !isLocalhost, maxAge: 3600, path: '/' });
  return response;
}
