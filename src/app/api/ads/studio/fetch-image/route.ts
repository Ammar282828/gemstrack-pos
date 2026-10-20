/**
 * GET ?url= → a picture from outside the shop, for the Studio board (the owner, 2026-10-12: "let me add any
 * instagram photos or outside photos also"). An image address comes back as it is; a page (an Instagram post, a
 * product page) gives the picture it shares (og:image / twitter:image). The browser can't fetch either itself (the
 * other site's CORS), so this server does, for a signed-in Studio user only, over https/http to a public host, at
 * most 15 MB. The picture then goes into the library like any upload.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { adsGate } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { publicUrl, sharedImage } from '@/lib/ads/studio/outside-image';
import { dailyCap, AI_PER_DAY } from '@/lib/daily-cap';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX = 15 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)';

/** True for an address the server must never fetch: loopback, private, link-local, carrier-grade NAT, unspecified. */
function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateIp(mapped[1]);
    return v === '::1' || v === '::' || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('fc') || v.startsWith('fd');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** https only, a public name, and every address it resolves to public (a name like x.nip.io points inside). */
async function safeUrl(u: URL): Promise<boolean> {
  if (u.protocol !== 'https:' || !publicUrl(u.toString())) return false;
  try {
    const addrs = await lookup(u.hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !privateIp(a.address));
  } catch { return false; }
}

/** No automatic redirects (a public address could send the server inside): each hop, at most 3, is checked again. */
async function get(u: URL): Promise<Response> {
  let cur = u;
  for (let hop = 0; hop < 4; hop++) {
    if (!(await safeUrl(cur))) throw Object.assign(new Error('That address is not allowed.'), { status: 400 });
    const res = await fetch(cur, { headers: { 'User-Agent': UA, Accept: 'image/*,text/html;q=0.9,*/*;q=0.5' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) return res;
    cur = new URL(loc, cur);
  }
  throw Object.assign(new Error('Too many redirects.'), { status: 502 });
}

async function body(res: Response): Promise<Uint8Array> {
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX) throw Object.assign(new Error('That picture is over 15 MB.'), { status: 413 });
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX) throw Object.assign(new Error('That picture is over 15 MB.'), { status: 413 });
  return buf;
}

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const capped = await dailyCap('ai', who, req, AI_PER_DAY);
  if (capped) return capped;
  const u = publicUrl(req.nextUrl.searchParams.get('url') || '');
  if (!u) return NextResponse.json({ error: 'Paste a web address (https://…).' }, { status: 400 });
  try {
    let res = await get(u);
    if (!res.ok) return NextResponse.json({ error: `That address answered ${res.status}.` }, { status: 502 });
    let type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) {
      const img = sharedImage(await res.text(), u);
      const iu = img ? publicUrl(img) : null;
      if (!iu) return NextResponse.json({ error: 'No picture found at that address. Instagram: open the post, Share → Copy link, and paste that. Or save the photo and upload it.' }, { status: 422 });
      res = await get(iu);
      type = res.headers.get('content-type') || '';
      if (!res.ok || !type.startsWith('image/')) return NextResponse.json({ error: 'The page’s picture could not be fetched. Save it and upload it instead.' }, { status: 502 });
    }
    return new NextResponse(new Uint8Array(await body(res)), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not fetch that picture.' }, { status });
  }
}
