import { NextRequest, NextResponse } from 'next/server';

const getBaseUrl = () =>
  process.env.TCS_USE_SANDBOX === 'true'
    ? 'https://devconnect.tcscourier.com'
    : 'https://ociconnect.tcscourier.com';

/**
 * TCS auth — two paths:
 *  Full (clientid + clientsecret configured):
 *    1. Authorization API  → bearerToken
 *    2. E-COM Auth API     → accessToken
 *  Fallback (username + password only):
 *    1. E-COM Auth API directly (no bearer header) → accessToken used as both
 */
async function getTcsTokens(): Promise<{ bearerToken: string; accessToken: string }> {
  const base = getBaseUrl();
  const hasClientCreds = !!(process.env.TCS_CLIENT_ID && process.env.TCS_CLIENT_SECRET);

  let bearerToken: string;

  if (hasClientCreds) {
    // Step 1 — Authorization (clientid + clientsecret)
    const authRes = await fetch(`${base}/auth/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientid: process.env.TCS_CLIENT_ID,
        clientsecret: process.env.TCS_CLIENT_SECRET,
      }),
    });
    if (!authRes.ok) {
      throw new Error(`TCS Authorization failed: HTTP ${authRes.status}`);
    }
    const authData = await authRes.json();
    if (!authData.result?.accessToken) {
      throw new Error(`TCS Authorization error: ${JSON.stringify(authData)}`);
    }
    bearerToken = authData.result.accessToken as string;
  } else {
    // No client creds — attempt E-COM auth without a bearer first to get the token,
    // then use it as bearer for subsequent calls.
    bearerToken = '';
  }

  // Step 2 — E-COM Authentication (username + password)
  const ecomHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) ecomHeaders['Authorization'] = `Bearer ${bearerToken}`;

  const ecomRes = await fetch(`${base}/ecom/api/authentication/token`, {
    method: 'POST',
    headers: ecomHeaders,
    body: JSON.stringify({
      username: process.env.TCS_USERNAME,
      password: process.env.TCS_PASSWORD,
    }),
  });

  if (!ecomRes.ok) {
    throw new Error(`TCS E-COM Authentication failed: HTTP ${ecomRes.status}`);
  }
  const ecomData = await ecomRes.json();
  if (!ecomData.accesstoken) {
    throw new Error(`TCS E-COM Authentication error: ${JSON.stringify(ecomData)}`);
  }

  const accessToken = ecomData.accesstoken as string;
  // If we skipped step 1, use accessToken as bearer too
  return { bearerToken: bearerToken || accessToken, accessToken };
}

export async function POST(req: NextRequest) {
  try {
    // Validate server credentials are configured
    const { TCS_USERNAME, TCS_PASSWORD } = process.env;
    if (!TCS_USERNAME || !TCS_PASSWORD) {
      return NextResponse.json(
        { error: 'TCS credentials are not configured. Add TCS_USERNAME and TCS_PASSWORD to .env.local.' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { action } = body as { action: string };

    const validActions = ['book', 'track', 'cancel', 'print_label'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }, { status: 400 });
    }

    const { bearerToken, accessToken } = await getTcsTokens();
    const base = getBaseUrl();
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    };

    // ── Book a new shipment ──────────────────────────────────────────────────
    if (action === 'book') {
      const { consignee, shipment } = body as {
        consignee: { name: string; mobile: string; address: string; cityCode: string; cityName: string };
        shipment: { referenceNo: string; description: string; weightKg: number; codAmount: number };
      };

      const nameParts = consignee.name.trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '.';

      const payload = {
        accesstoken: accessToken,
        shipperinfo: {
          tcsaccount: process.env.TCS_ACCOUNT_NUMBER,
          shippername: process.env.TCS_SHIPPER_NAME || 'Sender',
          address1: process.env.TCS_SHIPPER_ADDRESS || 'N/A',
          countrycode: 'PK',
          countryname: 'Pakistan',
          citycode: process.env.TCS_SHIPPER_CITY_CODE || 'KHI',
          cityname: process.env.TCS_SHIPPER_CITY_NAME || 'Karachi',
          mobile: process.env.TCS_SHIPPER_MOBILE || '03000000000',
        },
        consigneeinfo: {
          firstname: firstName,
          lastname: lastName,
          address1: consignee.address,
          countrycode: 'PK',
          countryname: 'Pakistan',
          citycode: consignee.cityCode.toUpperCase(),
          cityname: consignee.cityName,
          mobile: consignee.mobile,
        },
        shipmentinfo: {
          costcentercode: process.env.TCS_COST_CENTER_CODE || process.env.TCS_ACCOUNT_NUMBER,
          referenceno: shipment.referenceNo,
          contentdesc: shipment.description || 'Jewellery',
          servicecode: 'O',
          currency: 'PKR',
          codamount: Math.max(0, Number(shipment.codAmount) || 0),
          weightinkg: Math.max(0.5, Number(shipment.weightKg) || 0.5),
          pieces: 1,
          fragile: true,
          skus: [
            {
              description: shipment.description || 'Jewellery',
              quantity: 1,
              weight: Math.max(0.5, Number(shipment.weightKg) || 0.5),
              uom: 'KG',
              unitprice: Math.max(1, Number(shipment.codAmount) || 1),
            },
          ],
        },
      };

      const res = await fetch(`${base}/ecom/api/booking/create`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.ok ? 200 : 400 });
    }

    // ── Track a shipment ─────────────────────────────────────────────────────
    if (action === 'track') {
      const { consignmentNo } = body as { consignmentNo: string };
      const res = await fetch(`${base}/tracking/api/Tracking/GetDynamicTrackDetail`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ consignee: [consignmentNo] }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    // ── Cancel a booking ─────────────────────────────────────────────────────
    if (action === 'cancel') {
      const { consignmentNo } = body as { consignmentNo: string };
      const res = await fetch(`${base}/ecom/api/booking/cancel`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ consignmentNumber: consignmentNo, accesstoken: accessToken }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    // ── Print CN label ───────────────────────────────────────────────────────
    if (action === 'print_label') {
      const { consignmentNo } = body as { consignmentNo: string };
      const res = await fetch(`${base}/ecom/api/print/label`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ consignmentno: consignmentNo, shipperdetail: 'true', accesstoken: accessToken }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Unhandled action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown TCS API error';
    console.error('[TCS API Route]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
