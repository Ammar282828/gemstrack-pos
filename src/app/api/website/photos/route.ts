/**
 * Putting a photograph on the website, from the counter.
 *
 *   GET   → the collections a photo can go into, and how many are in each
 *   POST  → one photograph (multipart), forwarded to the site's drop folder
 *
 * The POS does not hold the photographs; the website does. This route is a
 * relay: the browser posts an image here with the staff member's own Google
 * sign-in, and the server forwards it to taheri.shop/api/upload.php with the
 * shared secret. The secret stays on this side — a browser never sees it, and
 * the site never has to trust a browser. Two boundaries, then: the site trusts
 * only this server, and this server trusts only a verified owner or staff
 * account. Neither is relaxed by the open-access switch.
 *
 * The site folds a dropped photograph into its gallery on the next page load,
 * so a piece photographed at the counter is public within seconds, with no
 * rebuild and no deploy.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { getCatalogAttributes } from '@/lib/website/catalog-source';
import { collectionOfKey } from '@/lib/website/pricing';

export const dynamic = 'force-dynamic';
// A photograph can be several megabytes; the default body cap is far smaller.
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024;
const EXTS = ['jpg', 'jpeg', 'png', 'webp'];

/**
 * Always a verified owner or staff member — this route deliberately does NOT
 * honour NEXT_PUBLIC_OPEN_ACCESS, the same way the order-actions route does
 * not. Open access takes the sign-in screen off the POS; it must not also
 * hand the public website's gallery to anyone who finds this URL. The page
 * signs its user in on its own when the rest of the app has not.
 */
async function gate(req: NextRequest): Promise<string | NextResponse> {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

const siteOrigin = () => (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');

/**
 * The site's folder tree, as it stands on disk at taheri.shop. Used when the
 * published catalogue is not reachable — adding a photograph must not depend
 * on the pricing work having shipped, and a counter with a tray of bangles
 * should never be told to come back later.
 */
const KNOWN_TREE: Record<string, string[]> = {
  'Rings & Bands': ['Rings', 'Diamond Rings', 'Bands', 'Palladium Bands for Him'],
  'Wristwear': ['Bangles', 'Thin Bangles', 'Kara Churi set', 'Karay', 'Stone Bangles', 'Diamond Bangles', 'Bracelet', 'Diamond Bracelets', 'String Bracelets', 'Bangle & Ring'],
  'Chains & Lockets': ['Chains', 'Lockets', 'Contemporary Lockets', 'Takhti', 'Taweez'],
  'Sets': ['Gold Sets', 'Diamond Sets', 'Stone Sets', 'String Set', 'Locket Set With Bangle', 'Locket sets without Bangle'],
  'Earrings': ['Tops', 'Diamond Tops', 'Jhumki', 'Baali'],
};

/**
 * The collections a photograph can go into. Read from the published catalogue
 * when it is there — that way the picker matches the site exactly and can show
 * how many pieces each holds — and from the known tree when it is not.
 */
export async function GET(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const origin = siteOrigin();
  const configured = !!process.env.WEBSITE_UPLOAD_SECRET;

  try {
    const catalog = await getCatalogAttributes();
    const byCollection = new Map<string, { category: string; count: number; sample: string }>();
    for (const key of Object.keys(catalog)) {
      const parts = key.split('/');
      if (parts.length < 3) continue;
      const [category, collection] = parts;
      const row = byCollection.get(collection);
      if (row) row.count++;
      else byCollection.set(collection, { category, count: 1, sample: key });
    }
    if (byCollection.size > 0) {
      const collections = [...byCollection.entries()]
        .map(([collection, v]) => ({
          collection,
          category: v.category,
          count: v.count,
          // The path a new photo goes to — "Earrings/Jhumki".
          folder: `${v.category}/${collection}`,
          sample: `${origin}/catalog-thumb/${encodeURI(v.sample)}`,
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.collection.localeCompare(b.collection));
      return NextResponse.json({ collections, configured, source: 'catalogue' });
    }
  } catch {
    // Falls through to the known tree below. Not an error worth surfacing:
    // the catalogue file only exists once the website's own build has shipped.
  }

  const collections = Object.entries(KNOWN_TREE).flatMap(([category, list]) =>
    list.map(collection => ({ collection, category, count: 0, folder: `${category}/${collection}`, sample: '' })));
  return NextResponse.json({ collections, configured, source: 'known-tree' });
}

export async function POST(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;

  const secret = process.env.WEBSITE_UPLOAD_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Photo uploads are not configured. Set WEBSITE_UPLOAD_SECRET on both the POS and the website.' }, { status: 503 });
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'Send the photograph as multipart/form-data.' }, { status: 400 }); }

  const file = form.get('file');
  const folder = String(form.get('folder') || '').trim();      // "Earrings/Jhumki"
  const nameHint = String(form.get('name') || '').trim();       // optional, else the file's own

  if (!(file instanceof File)) return NextResponse.json({ error: 'No photograph was received.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `That photograph is over ${MAX_BYTES / 1048576} MB.` }, { status: 413 });
  // Two plain segments, neither a dot-segment: the site's own sanitiser is
  // the boundary that matters, but a folder that could never be a collection
  // is refused here first.
  const segs = folder.split('/');
  if (segs.length !== 2 || segs.some(s => !s || s === '.' || s === '..' || /[\\\0]/.test(s))) {
    return NextResponse.json({ error: 'Choose a collection first.' }, { status: 400 });
  }

  const ext = (nameHint || file.name).split('.').pop()?.toLowerCase() || '';
  if (!EXTS.includes(ext)) return NextResponse.json({ error: `Photographs must be ${EXTS.join(', ')}.` }, { status: 415 });

  // Keep the name the counter gave it, minus anything that would change where
  // the file lands. The site's own sanitiser is the real boundary; this is so
  // the name stays recognisable rather than being mangled there.
  const base = (nameHint || file.name).replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || base === '.' || base === '..' || base.startsWith('.')) return NextResponse.json({ error: 'Give the photograph a name.' }, { status: 400 });
  const rel = `${folder}/${base}`;

  const out = new FormData();
  out.set('rel', rel);
  out.set('file', file, base);

  try {
    const res = await fetch(`${siteOrigin()}/api/upload.php`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
      body: out,
      signal: AbortSignal.timeout(55_000),
    });
    const text = await res.text();
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); }
    catch { return NextResponse.json({ error: `The website returned an unexpected reply (${res.status}).`, detail: text.slice(0, 200) }, { status: 502 }); }
    if (!res.ok || data.ok !== true) {
      return NextResponse.json({ error: String(data.error || `Upload refused (${res.status}).`) }, { status: res.status === 401 ? 502 : res.status });
    }
    return NextResponse.json({
      ok: true,
      rel: data.rel,
      bytes: data.bytes,
      thumb: `${siteOrigin()}${data.thumb}`,
      collection: collectionOfKey(String(data.rel)),
      uploadedBy: who,
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === 'TimeoutError'
      ? 'The website did not answer in time. The photograph may still have arrived — check the collection before retrying.'
      : e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: msg }, { status: 504 });
  }
}
