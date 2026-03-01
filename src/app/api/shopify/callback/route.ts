import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { FIRESTORE_PROJECT_ID, FIRESTORE_API_KEY } from '../_lib';

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
  const firestoreUrl =
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/app_settings/global` +
    `?key=${FIRESTORE_API_KEY}` +
    `&updateMask.fieldPaths=shopifyAccessToken` +
    `&updateMask.fieldPaths=shopifyStoreDomain`;

  await fetch(firestoreUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        shopifyAccessToken: { stringValue: accessToken },
        shopifyStoreDomain: { stringValue: shop },
      },
    }),
  });

  // Auto-register webhooks for real-time sync
  await fetch(`${appUrl}/api/shopify/register-webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop, token: accessToken }),
  });

  const response = NextResponse.redirect(`${appUrl}/settings?shopify=connected`);
  response.cookies.delete('shopify_oauth_state');
  return response;
}
