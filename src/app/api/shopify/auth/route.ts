import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const APP_URL = 'https://studio--hom-pos-52710474-ceeea.us-central1.hosted.app';
const REDIRECT_URI = `${APP_URL}/api/shopify/callback`;
const SCOPES = 'read_orders,read_customers,read_products';

export async function GET(request: NextRequest) {
  const shop = request.nextUrl.searchParams.get('shop');

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return NextResponse.json({ error: 'Invalid or missing shop parameter' }, { status: 400 });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SCOPES}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}`;

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('shopify_oauth_state', state, { httpOnly: true, secure: true, maxAge: 3600, path: '/' });
  return response;
}
