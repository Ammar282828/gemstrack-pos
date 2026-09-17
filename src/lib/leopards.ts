/**
 * Leopards Courier — the merchant API.
 *
 * Booking a packet returns a consignment number (the "CN"); tracking takes it
 * back. Both need the merchant key and password from the Leopards portal, so
 * this is inert until LEOPARDS_API_KEY and LEOPARDS_API_PASSWORD are set —
 * and the order page falls back to a CN typed in by hand, because the shop can
 * always book at the counter and still give the customer a tracking link.
 *
 * Field names follow Leopards' API v1 ("bookPacket", "trackBookedPacket");
 * amounts are rupees, weights grams. A `status` of 1 in the reply is success.
 */

export interface LeopardsConfig { apiKey: string; apiPassword: string; sandbox: boolean }

export interface LeopardsBooking {
  orderId: string;
  weightGrams: number;
  /** Rupees to collect on delivery. 0 for prepaid, which is the website's case. */
  collectAmount: number;
  originCity: string;
  destinationCity: string;
  shipper: { name: string; phone: string; address: string; email?: string };
  consignee: { name: string; phone: string; address: string; email?: string };
  instructions?: string;
}

export interface LeopardsResult { cn: string; trackingUrl: string; raw: unknown }

export class LeopardsNotConfiguredError extends Error {
  constructor() { super('Leopards is not configured: set LEOPARDS_API_KEY and LEOPARDS_API_PASSWORD.'); }
}

export function leopardsConfig(): LeopardsConfig | null {
  const apiKey = process.env.LEOPARDS_API_KEY;
  const apiPassword = process.env.LEOPARDS_API_PASSWORD;
  if (!apiKey || !apiPassword) return null;
  return { apiKey, apiPassword, sandbox: process.env.LEOPARDS_USE_SANDBOX === 'true' };
}

const base = (c: LeopardsConfig) =>
  c.sandbox ? 'https://merchantapistaging.leopardscourier.com/api' : 'https://merchantapi.leopardscourier.com/api';

export const trackingUrlFor = (cn: string) => `https://www.leopardscourier.com/tracking?cn=${encodeURIComponent(cn)}`;

async function call<T>(c: LeopardsConfig, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${base(c)}/${path}/format/json/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: c.apiKey, api_password: c.apiPassword, ...body }),
  });
  const data = (await res.json().catch(() => ({}))) as T & { status?: number; error?: string };
  if (!res.ok || data.status === 0) throw new Error(`Leopards ${path}: ${data.error || res.status}`);
  return data;
}

export async function bookPacket(b: LeopardsBooking): Promise<LeopardsResult> {
  const c = leopardsConfig();
  if (!c) throw new LeopardsNotConfiguredError();
  const data = await call<{ track_number?: string; slip_link?: string }>(c, 'bookPacket', {
    booked_packet_weight: Math.max(100, Math.round(b.weightGrams)),  // jewellery in its box; Leopards' minimum tier
    booked_packet_vol_weight_w: 10, booked_packet_vol_weight_h: 10, booked_packet_vol_weight_l: 10,
    booked_packet_no_piece: 1,
    booked_packet_collect_amount: Math.round(b.collectAmount),
    booked_packet_order_id: b.orderId,
    origin_city: b.originCity,
    destination_city: b.destinationCity,
    shipment_name_eng: b.shipper.name, shipment_email: b.shipper.email || '', shipment_phone: b.shipper.phone, shipment_address: b.shipper.address,
    consignment_name_eng: b.consignee.name, consignment_email: b.consignee.email || '', consignment_phone: b.consignee.phone, consignment_address: b.consignee.address,
    special_instructions: b.instructions || 'Jewellery — handle with care. Verify recipient identity.',
    shipment_type: 'overnight',
  });
  const cn = data.track_number || '';
  if (!cn) throw new Error('Leopards booked without a track number');
  return { cn, trackingUrl: trackingUrlFor(cn), raw: data };
}

export interface LeopardsTrack { cn: string; status: string; delivered: boolean; history: { at: string; status: string; location?: string }[] }

export async function trackPacket(cn: string): Promise<LeopardsTrack> {
  const c = leopardsConfig();
  if (!c) throw new LeopardsNotConfiguredError();
  const data = await call<{ packet_list?: { booked_packet_status?: string; 'Tracking Detail'?: { Status?: string; Activity_datetime?: string; Reciever_City?: string }[] }[] }>(
    c, 'trackBookedPacket', { track_numbers: cn },
  );
  const p = data.packet_list?.[0];
  const history = (p?.['Tracking Detail'] || []).map(h => ({ at: h.Activity_datetime || '', status: h.Status || '', location: h.Reciever_City }));
  const status = p?.booked_packet_status || history[history.length - 1]?.status || 'Unknown';
  return { cn, status, delivered: /deliver/i.test(status), history };
}

/** Leopards' city list is what destination_city must match; cached per instance. */
let cities: { at: number; names: string[] } | null = null;
export async function leopardsCities(): Promise<string[]> {
  const c = leopardsConfig();
  if (!c) throw new LeopardsNotConfiguredError();
  if (cities && Date.now() - cities.at < 24 * 3600 * 1000) return cities.names;
  const data = await call<{ city_list?: { name: string }[] }>(c, 'getAllCities', {});
  cities = { at: Date.now(), names: (data.city_list || []).map(x => x.name) };
  return cities.names;
}
