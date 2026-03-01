import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SCOPES = 'read_orders,read_customers,read_products';

export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get('shop');

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return NextResponse.json({ error: 'Invalid or missing shop parameter' }, { status: 400 });
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
