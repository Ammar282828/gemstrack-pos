/**
 * Where a website visitor is, as a place and never an address: country, region, city. Worked out at ingest
 * (POST /api/public/events) and the address dropped at once — nothing here stores or logs an IP.
 *
 * First the front end's own location headers, when it sends any (App Hosting documents none today, but Google's
 * load balancer, App Engine and Cloudflare each have theirs); otherwise the table in geo/ip-geo.bin.gz, built
 * from DB-IP's free "IP to City Lite" (CC BY 4.0) by scripts/geo-build.mjs: city and region for Pakistan and
 * the Gulf, the country elsewhere. 6 MB in memory once loaded; looked up by binary search.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface Place { cc: string; region: string; city: string; via: 'header' | 'table' | 'none' }

const NOWHERE: Place = { cc: '', region: '', city: '', via: 'none' };
const clean = (s: string | null | undefined) => (s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60);
const cc = (s: string | null | undefined) => { const c = clean(s).toUpperCase(); return /^[A-Z]{2}$/.test(c) && c !== 'ZZ' && c !== 'XX' ? c : ''; };

/** The front end's word for it, if it gave one. */
export function placeFromHeaders(h: Headers): Place | null {
  const country = cc(h.get('x-appengine-country') || h.get('x-client-geo-country') || h.get('cf-ipcountry') || h.get('x-vercel-ip-country') || h.get('x-country-code'));
  if (!country) {
    // Google's load balancer: X-Client-Geo-Location is "{client_region},{client_city}" (the region a country code).
    const loc = clean(h.get('x-client-geo-location'));
    const [r, c] = loc.split(',');
    if (cc(r)) return { cc: cc(r), region: '', city: titled(c), via: 'header' };
    return null;
  }
  const city = h.get('x-appengine-city') || h.get('x-client-geo-city') || h.get('cf-ipcity') || h.get('x-vercel-ip-city');
  const region = h.get('x-appengine-region') || h.get('x-client-geo-region-subdivision') || h.get('x-vercel-ip-country-region');
  return { cc: country, region: clean(decode(region)), city: titled(decode(city)), via: 'header' };
}

function decode(s: string | null) { try { return s ? decodeURIComponent(s) : ''; } catch { return s || ''; } }
/** App Engine sends cities lower-case ("karachi"). */
function titled(s: string | undefined) { const c = clean(s); return c && c === c.toLowerCase() ? c.replace(/\b\p{L}/gu, m => m.toUpperCase()) : c; }

interface Table { labels: string[]; v4: Uint32Array; l4: Uint16Array; v6: BigUint64Array; l6: Uint16Array }
let table: Table | null | undefined;

/**
 * The file's layout (scripts/geo-build.mjs): "IPG1", u32 places, u32 IPv4 ranges, u32 IPv6 ranges, u32 JSON length,
 * the places as a JSON array ("PK|Sindh|Karachi" or "GB"), then each family's range starts (u32, or the top 64 bits
 * of an IPv6 address) followed by their u16 place indexes, all big-endian. A range runs to the next one's start.
 */
export function readTable(buf: Buffer): Table {
  if (buf.toString('latin1', 0, 4) !== 'IPG1') throw new Error('not an ip-geo table');
  let o = 4;
  const n = buf.readUInt32BE(o); const n4 = buf.readUInt32BE(o + 4); const n6 = buf.readUInt32BE(o + 8); const j = buf.readUInt32BE(o + 12); o += 16;
  const labels = JSON.parse(buf.toString('utf8', o, o + j)) as string[]; o += j;
  if (labels.length !== n) throw new Error('ip-geo table: place count');
  const v4 = new Uint32Array(n4); for (let i = 0; i < n4; i++, o += 4) v4[i] = buf.readUInt32BE(o);
  const l4 = new Uint16Array(n4); for (let i = 0; i < n4; i++, o += 2) l4[i] = buf.readUInt16BE(o);
  const v6 = new BigUint64Array(n6); for (let i = 0; i < n6; i++, o += 8) v6[i] = buf.readBigUInt64BE(o);
  const l6 = new Uint16Array(n6); for (let i = 0; i < n6; i++, o += 2) l6[i] = buf.readUInt16BE(o);
  return { labels, v4, l4, v6, l6 };
}

function loadTable(): Table | null {
  if (table !== undefined) return table;
  try { table = readTable(gunzipSync(readFileSync(path.join(process.cwd(), 'src/lib/website/geo/ip-geo.bin.gz')))); }
  catch (e) { console.warn('[geo] no address table:', e instanceof Error ? e.message : e); table = null; }
  return table;
}

/** The last range that starts at or before `x`. */
function floor<T extends number | bigint>(starts: ArrayLike<T>, x: T): number {
  let lo = 0, hi = starts.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (starts[mid] <= x) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at;
}

export function parseV4(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some(x => x > 255) ? null : ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

/** The top 64 bits of an IPv6 address (enough to place it), or null. */
export function parseV6Top(ip: string): bigint | null {
  if (!ip.includes(':') || !/^[0-9a-f:.]+$/i.test(ip)) return null;
  const [h, t, extra] = ip.split('::');
  if (extra !== undefined) return null;
  const head = h ? h.split(':') : [];
  const tail = t === undefined ? null : t ? t.split(':') : [];
  const groups = tail === null ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  if (groups.length < 4) return null;
  let n = BigInt(0);
  for (const g of groups.slice(0, 4)) { if (!/^[0-9a-f]{0,4}$/i.test(g)) return null; n = (n << BigInt(16)) + BigInt(parseInt(g || '0', 16)); }
  return n;
}

export function lookupIn(t: Table, ip: string): Place {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const a4 = parseV4(mapped || ip);
  let label = '';
  if (a4 !== null) { const i = floor(t.v4, a4); if (i >= 0) label = t.labels[t.l4[i]]; }
  else { const a6 = parseV6Top(ip); if (a6 !== null) { const i = floor(t.v6, a6); if (i >= 0) label = t.labels[t.l6[i]]; } }
  if (!label) return NOWHERE;
  const [c, region = '', city = ''] = label.split('|');
  return { cc: c, region, city, via: 'table' };
}

/** An address's country alone ("" when unknown): for the events route's check of which header holds the visitor. */
export function countryOf(ip: string): string {
  const t = loadTable();
  return t && ip ? lookupIn(t, ip.trim()).cc || '?' : '';
}

/** The visitor's place; `ip` is used here and nowhere else. */
export function placeFor(h: Headers, ip: string): Place {
  const fromHeader = placeFromHeaders(h);
  if (fromHeader) return fromHeader;
  const t = loadTable();
  return t && ip ? lookupIn(t, ip) : NOWHERE;
}
