/**
 * TCS's Cash on Delivery API (owner, 2026-11-09: "make the shipping slips (CN bookings) … directly from my ERP"): the pure
 * half — what is sent and how a reply is read. The calls are lib/tcs-cod-server.ts.
 *
 * From TCS's developer portal (IBM API Connect, "Cash on Delivery API 1.0.0"):
 *   base https://api.tcscourier.com/production/v1/cod, header X-IBM-Client-Id: <the app's client ID>
 *   GET  /cities, /origins, /countries
 *   POST /create-order       {userName, password, costCenterCode, consigneeName, consigneeAddress, consigneeMobNo,
 *                             consigneeEmail, originCityName, destinationCityName, weight (kg), pieces, codAmount (text),
 *                             customerReferenceNo, services ("O" overnight), productDetails, fragile ("Yes"/"No"),
 *                             remarks, insuranceValue}
 *   PUT  /cancel-order       {userName, password, consignmentNumber}
 *   GET  /track-order        ?userName&password&referenceNo
 *   GET  /payment-details    ?consignmentNumber;  GET /payment-invoice ?invoiceNumber
 *   POST /reverse-logistics  {userName, password, costCenterCode, consignmentNo, consigneeMobNo}
 * Every reply carries returnStatus {code ("0200" is success), status, message}.
 *
 * The portal documents the requests, not the replies' bodies, and the account had no subscription when this was written
 * (2026-11-09: /cities answered 401), so every reader here looks for its answer by shape rather than by one path.
 */

import type { TcsCredentials } from '@/lib/tcs-payments';

export const TCS_COD_BASE = 'https://api.tcscourier.com/production/v1/cod';

/** TCS's own page for a consignment, for the customer and the shop. */
export const tcsTrackUrl = (cn: string) => `https://www.tcsexpress.com/track/${encodeURIComponent(cn)}`;

/** A consignment number as TCS writes them: digits, 6 to 20. */
export const isCn = (v: unknown): v is string => typeof v === 'string' && /^\d{6,20}$/.test(v.trim());

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

// ─── returnStatus ────────────────────────────────────────────────────────────

export interface TcsReturnStatus { ok: boolean; code: string; status: string; message: string }

/** The reply's returnStatus (any casing, at the top or one level down); ok when its code is 0200 or its status SUCCESS. */
export function returnStatusOf(reply: unknown): TcsReturnStatus {
  const find = (o: unknown, depth: number): Obj | null => {
    if (!isObj(o) || depth > 2) return null;
    for (const [k, v] of Object.entries(o)) if (/^returnstatus$/i.test(k) && isObj(v)) return v;
    for (const v of Object.values(o)) { const f = find(v, depth + 1); if (f) return f; }
    return null;
  };
  const r = find(reply, 0);
  if (!r) {
    // An IBM gateway refusal: {httpCode: "401", httpMessage, moreInformation}.
    const o = isObj(reply) ? reply : {};
    const message = String(o.moreInformation ?? o.message ?? o.httpMessage ?? '').trim();
    return { ok: false, code: String(o.httpCode ?? ''), status: String(o.httpMessage ?? ''), message };
  }
  const pick = (re: RegExp) => { for (const [k, v] of Object.entries(r)) if (re.test(k)) return String(v ?? '').trim(); return ''; };
  const code = pick(/^code$/i), status = pick(/^status$/i), message = pick(/^message$/i);
  return { ok: code === '0200' || /^success$/i.test(status), code, status, message };
}

/** Plain words for a refusal, for the toast. */
export function tcsRefusal(reply: unknown, httpStatus: number): string {
  const r = returnStatusOf(reply);
  if (httpStatus === 401 || r.code === '401') return 'TCS has not opened this account to the API yet (not authorised). Booking will work once TCS approves the subscription.';
  const words = r.message || r.status || (httpStatus ? `HTTP ${httpStatus}` : 'no answer');
  return `TCS said: ${words}${r.code && r.code !== '0200' ? ` (${r.code})` : ''}`;
}

// ─── Lists ───────────────────────────────────────────────────────────────────

/** City names from /cities or /origins, whatever the list is called and whatever each row names its city. */
export function parseCities(reply: unknown): string[] {
  const out = new Set<string>();
  const nameOf = (row: unknown): string => {
    if (typeof row === 'string') return row.trim();
    if (!isObj(row)) return '';
    for (const k of ['cityName', 'CityName', 'city_name', 'name', 'Name', 'city', 'City', 'originCityName', 'description']) {
      const v = row[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const walk = (v: unknown, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      for (const row of v) { const n = nameOf(row); if (n && n.length <= 60) out.add(n); }
      return;
    }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!/^returnstatus$/i.test(k)) walk(x, depth + 1);
  };
  walk(reply, 0);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** The city TCS knows, matched loosely ("karachi " → "Karachi"); the typed name when the list is empty or has no match. */
export function matchCity(typed: string, cities: string[]): string {
  const t = typed.trim();
  if (!t || !cities.length) return t;
  const low = t.toLowerCase();
  return cities.find(c => c.toLowerCase() === low)
    ?? cities.find(c => c.toLowerCase().replace(/[^a-z]/g, '') === low.replace(/[^a-z]/g, ''))
    ?? t;
}

// ─── Booking ─────────────────────────────────────────────────────────────────

export interface TcsBookingInput {
  consignee: { name: string; address: string; mobile: string; email?: string };
  destinationCity: string;
  /** Kilograms. */
  weight: number;
  pieces: number;
  /** What the rider collects, whole rupees; 0 when it is paid. */
  codAmount: number;
  /** The order's number on the parcel (ERP id or Shopify #). */
  reference: string;
  productDetails?: string;
  fragile?: boolean;
  remarks?: string;
  insuranceValue?: number;
}

/** "+92 300 1234567", "923001234567", "0300-1234567" → "03001234567" (TCS's local form); other numbers as digits. */
export function tcsMobile(raw: string): string {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0092')) d = d.slice(2);
  if (d.startsWith('92') && d.length === 12) d = `0${d.slice(2)}`;
  if (d.length === 10 && d.startsWith('3')) d = `0${d}`;
  return d;
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The create-order body, or why it cannot be sent. */
export function buildCreateOrder(c: TcsCredentials, input: TcsBookingInput): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const name = clip(input.consignee?.name, 100);
  const address = clip(input.consignee?.address, 300);
  const mobile = tcsMobile(input.consignee?.mobile || '');
  const city = clip(input.destinationCity, 60);
  const weight = Number(input.weight);
  const pieces = Math.round(Number(input.pieces));
  const cod = Math.round(Number(input.codAmount));
  if (!name) return { ok: false, error: "The receiver's name is missing." };
  if (address.length < 5) return { ok: false, error: 'The delivery address is missing.' };
  if (mobile.length < 10 || mobile.length > 13) return { ok: false, error: "The receiver's mobile number does not look right." };
  if (!city) return { ok: false, error: 'Which city is it going to?' };
  if (!Number.isFinite(weight) || weight <= 0 || weight > 100) return { ok: false, error: 'The weight must be between 0.01 and 100 kg.' };
  if (!Number.isFinite(pieces) || pieces < 1 || pieces > 50) return { ok: false, error: 'Pieces must be between 1 and 50.' };
  if (!Number.isFinite(cod) || cod < 0 || cod > 5_000_000) return { ok: false, error: 'The cash to collect must be 0 or more.' };
  const email = clip(input.consignee?.email, 100);
  return {
    ok: true,
    payload: {
      userName: c.username,
      password: c.password,
      costCenterCode: c.costCenterCode,
      consigneeName: name,
      consigneeAddress: address,
      consigneeMobNo: mobile,
      consigneeEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
      originCityName: c.originCity || 'Karachi',
      destinationCityName: city,
      weight: Math.round(weight * 100) / 100,
      pieces,
      codAmount: String(cod),
      customerReferenceNo: clip(input.reference, 40),
      services: 'O',
      productDetails: clip(input.productDetails || 'Jewellery', 200),
      fragile: input.fragile === false ? 'No' : 'Yes',
      remarks: clip(input.remarks, 200),
      insuranceValue: Math.max(0, Math.round(Number(input.insuranceValue) || 0)),
    },
  };
}

/**
 * The consignment number in a create-order reply. Undocumented, so: a field named like one (bookingReply.result,
 * consignmentNo, consignmentNumber, cn, cnNo, trackingNumber, result) anywhere in the reply holding 6–20 digits, else a
 * message that carries the digits ("Order created … CN: 123…").
 */
export function cnFromReply(reply: unknown): string | null {
  const NAMED = /^(consignment(no|number|num)?|cn(no|number)?|tracking(no|number)?|result|bookingreply|referenceno)$/i;
  const asCn = (v: unknown): string | null => {
    if (typeof v === 'number' && Number.isInteger(v)) v = String(v);
    return isCn(v) ? (v as string).trim() : null;
  };
  const named = (v: unknown, depth: number): string | null => {
    if (depth > 5) return null;
    if (Array.isArray(v)) { for (const x of v) { const f = named(x, depth + 1); if (f) return f; } return null; }
    if (!isObj(v)) return null;
    for (const [k, x] of Object.entries(v)) if (NAMED.test(k)) { const f = asCn(x); if (f) return f; }
    for (const [k, x] of Object.entries(v)) if (!/^returnstatus$/i.test(k)) { const f = named(x, depth + 1); if (f) return f; }
    return null;
  };
  const found = named(reply, 0);
  if (found) return found;
  const msg = returnStatusOf(reply).message;
  const m = /\b(\d{9,20})\b/.exec(msg);
  return m ? m[1] : null;
}

/** The reply's outline (keys and value kinds, no values), for the log line on the first real booking. */
export function replyShape(v: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.length ? [replyShape(v[0], depth + 1)] : [];
  if (isObj(v)) return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, replyShape(x, depth + 1)]));
  return typeof v;
}

// ─── Tracking ────────────────────────────────────────────────────────────────

/** Where a parcel is, in the ERP's words (as lib/shopify-delivery.ts, with booked and cancelled). */
export type ParcelState = 'booked' | 'shipped' | 'in_transit' | 'out_for_delivery' | 'attempted' | 'delivered' | 'returned' | 'cancelled';

export interface TrackEvent { at: string; status: string; location?: string }

export interface TcsTrack {
  /** TCS's latest word, as it wrote it. */
  status: string;
  state: ParcelState;
  events: TrackEvent[];
  deliveredAt?: string;
  receivedBy?: string;
}

/** A courier's line, read as a state. Order matters: "Return to origin" is a return, "Delivered to origin" too. */
export function stateOfText(text: string): ParcelState | null {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  if (/cancel/.test(t)) return 'cancelled';
  if (/return|\brto\b|\brts\b/.test(t)) return 'returned';
  // TCS's own codes: OK / DV are delivered.
  if (/^(ok|dv)$/.test(t.trim())) return 'delivered';
  if (/deliver(ed|y completed)|received by|\bdlvd\b/.test(t) && !/out for deliver|not deliver|undeliver|deliver(y)? attempt|attempted/.test(t)) return 'delivered';
  if (/attempt|not deliver|undeliver|refus|consignee not|address (not|incomplete)|closed|unreachable|not available|reschedul/.test(t)) return 'attempted';
  if (/out for deliver|on route|with courier for deliver|dispatched for deliver/.test(t)) return 'out_for_delivery';
  if (/transit|arrived|departed|received at|forwarded|in route|en route|hub|facility|manifest|picked|pick ?up|collected/.test(t)) return 'in_transit';
  if (/book|order (created|placed)|shipment (created|information received)|label/.test(t)) return 'booked';
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * A courier's time as ISO, Karachi's clock where it names no zone (PKT, +05:00): "2026-11-09 14:05:00", "09/11/2026 2:05 PM",
 * "Monday Nov 09, 2026 14:05", "09-Nov-2026 14:05". The text as given when it cannot be read.
 */
export function courierTime(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s) && Number.isFinite(Date.parse(s))) return new Date(Date.parse(s)).toISOString();
  const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(s);
  let h = time ? Number(time[1]) : 0;
  const min = time ? Number(time[2]) : 0, sec = time?.[3] ? Number(time[3]) : 0;
  if (time?.[4]) { const pm = /p/i.test(time[4]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  let y = 0, mo = 0, d = 0;
  let m: RegExpExecArray | null;
  if ((m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = /(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{4})/.exec(s))) { d = +m[1]; mo = MONTHS[m[2].toLowerCase()] || 0; y = +m[3]; }
  else if ((m = /([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s))) { mo = MONTHS[m[1].toLowerCase()] || 0; d = +m[2]; y = +m[3]; }
  if (!y || !mo || !d || mo > 12 || d > 31) return s;
  const utc = Date.UTC(y, mo - 1, d, h - 5, min, sec);
  return Number.isFinite(utc) ? new Date(utc).toISOString() : s;
}

const FIELD = {
  at: ['dateTime', 'datetime', 'DateTime', 'date_time', 'date', 'Date', 'eventDate', 'statusDate', 'timestamp', 'time', 'happened_at', 'activityDate'],
  status: ['status', 'Status', 'statusDescription', 'description', 'activity', 'Activity', 'message', 'remarks', 'event'],
  location: ['location', 'Location', 'city', 'City', 'station', 'Station', 'branch', 'origin', 'stationName'],
  receivedBy: ['recievedBy', 'receivedBy', 'ReceivedBy', 'RecievedBy', 'receiverName', 'receiver'],
};
const firstText = (o: Obj, keys: string[]) => { for (const k of keys) { const v = o[k]; if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return String(v).trim(); } return ''; };

/**
 * TCS's track-order reply, normalised: every row anywhere in it that has a time and a status (Checkpoints, DeliveryInfo,
 * TrackInfo, history, …) as an event, newest first, without repeats; the parcel's state from the newest line that says one.
 */
export function normaliseTcsTrack(reply: unknown): TcsTrack | null {
  const rows: Obj[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 6) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (!isObj(v)) return;
    if (firstText(v, FIELD.status) && firstText(v, FIELD.at)) rows.push(v);
    for (const [k, x] of Object.entries(v)) if (!/^returnstatus$/i.test(k) && (isObj(x) || Array.isArray(x))) walk(x, depth + 1);
  };
  walk(reply, 0);
  const seen = new Set<string>();
  let receivedBy = '';
  const events: TrackEvent[] = [];
  for (const r of rows) {
    const at = courierTime(firstText(r, FIELD.at));
    const status = firstText(r, FIELD.status);
    const location = firstText(r, FIELD.location);
    const key = `${at}|${status.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    receivedBy ||= firstText(r, FIELD.receivedBy);
    events.push({ at, status, ...(location && { location }) });
  }
  if (!events.length) return null;
  events.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  let state: ParcelState = 'booked';
  for (const e of events) { const s = stateOfText(e.status); if (s) { state = s; break; } }
  if (state === 'booked' && events.length > 1) state = 'in_transit';
  const delivered = state === 'delivered' ? events.find(e => stateOfText(e.status) === 'delivered') : undefined;
  return {
    status: events[0].status,
    state,
    events,
    ...(delivered?.at && { deliveredAt: delivered.at }),
    ...(receivedBy && state === 'delivered' && { receivedBy }),
  };
}

/** What TCS has done with the cash it collected for a parcel (/payment-details), read loosely. */
export function parsePaymentDetails(reply: unknown): { paid: boolean; amount?: number; paidOn?: string; invoiceNumber?: string } | null {
  let row: Obj | null = null;
  const walk = (v: unknown, depth: number) => {
    if (row || depth > 5) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (!isObj(v)) return;
    if (Object.keys(v).some(k => /pay|amount|invoice/i.test(k) && !/^returnstatus$/i.test(k) && !isObj(v[k]) && !Array.isArray(v[k]))) { row = v; return; }
    for (const [k, x] of Object.entries(v)) if (!/^returnstatus$/i.test(k)) walk(x, depth + 1);
  };
  walk(reply, 0);
  if (!row) return null;
  const r = row as Obj;
  const get = (re: RegExp) => { for (const [k, v] of Object.entries(r)) if (re.test(k) && v !== null && v !== '') return String(v).trim(); return ''; };
  const status = get(/^(payment)?status$/i);
  const amount = Number(get(/amount/i).replace(/[^\d.]/g, ''));
  const paidOn = get(/(payment|paid).*date|date.*(payment|paid)/i);
  const invoiceNumber = get(/invoice/i);
  return {
    paid: /^(y|yes|paid|true)$/i.test(status) || !!paidOn,
    ...(Number.isFinite(amount) && amount > 0 && { amount: Math.round(amount) }),
    ...(paidOn && { paidOn: courierTime(paidOn) }),
    ...(invoiceNumber && { invoiceNumber }),
  };
}
