/**
 * Builds src/lib/website/geo/ip-geo.bin.gz — the address → place table the site analytics use at ingest
 * (lib/website/geo.ts) when the front end gives no location header. From DB-IP's free "IP to City Lite"
 * (CC BY 4.0, https://db-ip.com — the Interest screen credits it). Pakistan and the Gulf keep region and city
 * (where the shops' visitors are); everywhere else keeps the country, so the file stays a few MB.
 *
 *   node scripts/geo-build.mjs [month]     # month like 2026-10; default this month, else last
 *
 * Re-run now and then (a few times a year is plenty) and commit the file. Format: see readTable in geo.ts.
 */
import { createGunzip, gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import readline from 'node:readline';

const CITY = new Set(['PK', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH']);
const OUT = new URL('../src/lib/website/geo/ip-geo.bin.gz', import.meta.url);

const month = (d) => d.toISOString().slice(0, 7);
const now = new Date();
const tries = process.argv[2] ? [process.argv[2]] : [month(now), month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))];

let res;
for (const m of tries) {
  res = await fetch(`https://download.db-ip.com/free/dbip-city-lite-${m}.csv.gz`);
  if (res.ok) { console.log('DB-IP', m); break; }
}
if (!res?.ok) throw new Error(`DB-IP download failed (${res?.status})`);

/** One CSV line; DB-IP quotes fields holding commas. */
function fields(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

function v4(a) { const p = a.split('.').map(Number); return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]; }
/** The top 64 bits of an IPv6 address, as a BigInt. */
function v6top(a) {
  const [h, t] = a.split('::');
  const head = h ? h.split(':') : []; const tail = t != null ? (t ? t.split(':') : []) : null;
  const groups = tail == null ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  return groups.slice(0, 4).reduce((n, g) => (n << 16n) + BigInt(parseInt(g || '0', 16)), 0n);
}

const labels = ['']; const index = new Map([['', 0]]);
const lab = (s) => { if (!index.has(s)) { index.set(s, labels.length); labels.push(s); } return index.get(s); };
const r4 = []; const r6 = []; let last4 = -1; let last6 = -1;

const rl = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const [a, , , cc, region, city] = fields(line);
  const l = lab(!cc || cc === 'ZZ' ? '' : CITY.has(cc) ? `${cc}|${region}|${city}` : cc);
  if (a.includes(':')) {
    const s = v6top(a);
    if (r6.length && r6[r6.length - 1][0] === s) { r6[r6.length - 1][1] = l; last6 = l; continue; }
    if (l !== last6) { r6.push([s, l]); last6 = l; }
  } else if (l !== last4) { r4.push([v4(a), l]); last4 = l; }
}

const json = Buffer.from(JSON.stringify(labels));
const buf = Buffer.alloc(16 + 4 + json.length + r4.length * 6 + r6.length * 10);
let o = 0;
buf.write('IPG1', o); o += 4;
buf.writeUInt32BE(labels.length, o); o += 4;
buf.writeUInt32BE(r4.length, o); o += 4;
buf.writeUInt32BE(r6.length, o); o += 4;
buf.writeUInt32BE(json.length, o); o += 4;
json.copy(buf, o); o += json.length;
for (const [s] of r4) { buf.writeUInt32BE(s, o); o += 4; }
for (const [, l] of r4) { buf.writeUInt16BE(l, o); o += 2; }
for (const [s] of r6) { buf.writeBigUInt64BE(s, o); o += 8; }
for (const [, l] of r6) { buf.writeUInt16BE(l, o); o += 2; }
const gz = gzipSync(buf, { level: 9 });
writeFileSync(OUT, gz);
console.log(`${labels.length} places, ${r4.length} IPv4 and ${r6.length} IPv6 ranges; ${(buf.length / 1e6).toFixed(1)} MB → ${(gz.length / 1e6).toFixed(1)} MB gzipped`);
