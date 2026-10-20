import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { adminDb } from '@/lib/firebase-admin';

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY!;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

function validateHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get('hmac');
  if (!hmac) return false;
  const entries: string[] = [];
  params.forEach((value, key) => { if (key !== 'hmac') entries.push(`${key}=${value}`); });
  entries.sort();
  const digest = crypto.createHmac('sha256', secret).update(entries.join('&')).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex'));
  } catch { return false; }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const stateCookie = request.cookies.get('shopify_oauth_state')?.value;
  const state = searchParams.get('state');

  const host = request.headers.get('host') || '';
  const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  const appUrl = isLocalhost ? `http://${host}` : `https://${host}`;

  if (!state || state !== stateCookie) {
    return NextResponse.redirect(`${appUrl}/settings?shopify=error&reason=state`);
  }
  if (!validateHmac(searchParams, SHOPIFY_API_SECRET)) {
    return NextResponse.redirect(`${appUrl}/settings?shopify=error&reason=hmac`);
  }

  const shop = searchParams.get('shop')!;
  // The sign-in cookie only proves the same browser started the install, and /auth is open, so a stranger can
  // install the app on a shop of their own. Never re-point the ERP at a different shop than the one connected.
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return NextResponse.redirect(`${appUrl}/settings?shopify=error&reason=shop`);
  }
  const current = String((await adminDb.collection('app_settings').doc('global').get()).get('shopifyStoreDomain') || '').toLowerCase();
  if (current && current !== shop.toLowerCase()) {
    console.warn('[shopify/callback] refused: install is for a different shop than the connected one');
    return NextResponse.redirect(`${appUrl}/settings?shopify=error&reason=other-shop`);
  }
  const code = searchParams.get('code')!;

  // Exchange code for access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code }),
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    return NextResponse.redirect(`${appUrl}/settings?shopify=error&reason=token`);
  }

  // Save token + domain to Firestore
  await adminDb.collection('app_settings').doc('global').set({
    shopifyAccessToken: accessToken,
    shopifyStoreDomain: shop,
    shopifyGrantedScopes: tokenData.scope || '',
  }, { merge: true });

  // Auto-register webhooks for real-time sync
  // Server to server, so it proves itself with the scheduler's key (register-webhooks refuses anyone else).
  await fetch(`${appUrl}/api/shopify/register-webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) },
    body: JSON.stringify({ shop, token: accessToken }),
  });

  const response = NextResponse.redirect(`${appUrl}/settings?shopify=connected`);
  response.cookies.delete('shopify_oauth_state');
  return response;
}
