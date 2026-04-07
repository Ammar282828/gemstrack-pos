import { NextRequest, NextResponse } from 'next/server';

const getBaseUrl = () =>
  process.env.TCS_USE_SANDBOX === 'true'
    ? 'https://devconnect.tcscourier.com'
    : 'https://ociconnect.tcscourier.com';

/**
 * TCS auth — requires TCS_CLIENT_ID + TCS_CLIENT_SECRET:
 *  1. POST /auth/api/auth  → bearerToken
 *  2. GET  /ecom/api/authentication/token?username=…&password=…  → accessToken
 */
async function getTcsTokens(): Promise<{ bearerToken: string; accessToken: string }> {
  const base = getBaseUrl();

  const clientId = process.env.TCS_CLIENT_ID;
  const clientSecret = process.env.TCS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('TCS_CLIENT_ID and TCS_CLIENT_SECRET are required. Add them to .env.local.');
  }

  // Step 1 — Authorization (clientid + clientsecret) → bearerToken
  const authRes = await fetch(`${base}/auth/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientid: clientId, clientsecret: clientSecret }),
  });
  if (!authRes.ok) {
    throw new Error(`TCS Authorization failed: HTTP ${authRes.status}`);
  }
  const authData = await authRes.json();
  if (!authData.result?.accessToken) {
    throw new Error(`TCS Authorization error: ${JSON.stringify(authData)}`);
  }
  const bearerToken = authData.result.accessToken as string;

  // Step 2 — E-COM Authentication (GET with query params + bearer header) → accessToken
  const ecomUrl = new URL(`${base}/ecom/api/authentication/token`);
  ecomUrl.searchParams.set('username', process.env.TCS_USERNAME || '');
  ecomUrl.searchParams.set('password', process.env.TCS_PASSWORD || '');

  const ecomRes = await fetch(ecomUrl.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${bearerToken}` },
  });

  if (!ecomRes.ok) {
    throw new Error(`TCS E-COM Authentication failed: HTTP ${ecomRes.status}`);
  }
  const ecomData = await ecomRes.json();
  if (!ecomData.accesstoken) {
    throw new Error(`TCS E-COM Authentication error: ${JSON.stringify(ecomData)}`);
  }

  return { bearerToken, accessToken: ecomData.accesstoken as string };
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

    // ── Track a shipment (GET) ───────────────────────────────────────────────
    if (action === 'track') {
      const { consignmentNo } = body as { consignmentNo: string };
      const trackUrl = new URL(`${base}/tracking/api/Tracking/GetDynamicTrackDetail`);
      trackUrl.searchParams.set('consignee', consignmentNo);
      trackUrl.searchParams.set('accesstoken', accessToken);

      const res = await fetch(trackUrl.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerToken}` },
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    // ── Cancel a booking (POST) ──────────────────────────────────────────────
    if (action === 'cancel') {
      const { consignmentNo } = body as { consignmentNo: string };
      const res = await fetch(`${base}/ecom/api/booking/cancel`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ consignmentnumber: consignmentNo, accesstoken: accessToken }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    // ── Print CN label (GET) ─────────────────────────────────────────────────
    if (action === 'print_label') {
      const { consignmentNo } = body as { consignmentNo: string };
      const labelUrl = new URL(`${base}/ecom/api/print/label`);
      labelUrl.searchParams.set('consignmentno', consignmentNo);
      labelUrl.searchParams.set('shipperdetail', 'true');
      labelUrl.searchParams.set('accesstoken', accessToken);

      const res = await fetch(labelUrl.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerToken}` },
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
