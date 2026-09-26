/**
 * Putting a photograph on the website, from the counter.
 *
 *   GET   → the collections a photo can go into, and how many are in each
 *   POST  → one photograph (multipart), forwarded to the site's drop folder
 *
 * The POS does not hold the photographs; the website does. This route is a
 * relay: the browser posts an image here with whatever session the POS runs
 * on, and the server forwards it to taheri.shop/api/upload.php with the
 * shared secret. The secret stays on this side — a browser never sees it, and
 * the site never has to trust a browser. The site trusts only this server;
 * this server trusts whoever the POS trusts.
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
import convertHeic from 'heic-convert';
import { SiteUploadError, siteOrigin, uploadToSite } from '@/lib/website/upload';

export const dynamic = 'force-dynamic';
// A photograph can be several megabytes; the default body cap is far smaller.
export const maxDuration = 60;

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';
const MAX_BYTES = 25 * 1024 * 1024;
// What the site's drop folder takes, as-is.
const EXTS = ['jpg', 'jpeg', 'png', 'webp'];
// What an iPhone actually hands over. Converted to JPEG here, on the server,
// so neither the phone nor the site has to know HEIC exists: the browser can
// not reliably decode it, and the site's image pipeline does not need to.
const HEIC_EXTS = ['heic', 'heif'];
const isHeic = (ext: string, mime: string) => HEIC_EXTS.includes(ext) || /^image\/hei[cf]/i.test(mime);

/**
 * Whoever the POS lets in. Under NEXT_PUBLIC_OPEN_ACCESS that is anyone who
 * reaches the app, and — decided by Ammar on 2026-09-20 — that includes
 * putting photographs on the website: the counter must not have to sign in
 * to do it. So, unlike the order-actions route, this one follows the open
 * switch. While it is on, anyone who finds this URL can add an image to
 * taheri.shop's gallery; dropping NEXT_PUBLIC_OPEN_ACCESS from
 * apphosting.yaml closes that along with the rest of the app, and the
 * verified owner/staff check below takes over.
 */
async function gate(req: NextRequest): Promise<string | NextResponse> {
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}


/**
 * The site's folder tree, as it stands on disk at taheri.shop. Two jobs: the
 * whole picker when the published catalogue is not reachable — adding a
 * photograph must not depend on the pricing work having shipped — and, when
 * it is, the collections the catalogue cannot know about yet because they
 * hold no photograph: a new folder (Watches, Opals) shows here with a count
 * of nought so the counter can be the one to fill it.
 */
const KNOWN_TREE_ORIGIN = 'https://taheri.shop';
const KNOWN_TREE: Record<string, string[]> = {
  'Rings & Bands': ['Rings', 'Diamond Rings', 'Bands', 'Palladium Bands for Him'],
  'Wristwear': ['Bangles', 'Thin Bangles', 'Kara Churi set', 'Karay', 'Stone Bangles', 'Diamond Bangles', 'Bracelet', 'Diamond Bracelets', 'String Bracelets', 'Bangle & Ring', 'The Maisons'],
  'Chains & Lockets': ['Chains', 'Lockets', 'Contemporary Lockets', 'Takhti', 'Taweez'],
  'Sets': ['Gold Sets', 'Diamond Sets', 'Stone Sets', 'String Set', 'Locket Set With Bangle', 'Locket sets without Bangle'],
  'Earrings': ['Tops', 'Diamond Tops', 'Jhumki', 'Baali'],
  'Gemstones': ['Opals'],
  'Watches': ['Watches'],
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

  // A site that states its own tree is taken at its word. House of Mina's
  // catalogue publishes catalog-tree.json (every folder, empty ones included,
  // with counts and a sample); taheri.shop does not, and falls through to the
  // catalogue-and-known-tree reading below. KNOWN_TREE is Taheri's, so it must
  // never be offered for a site that has its own.
  try {
    const res = await fetch(`${origin}/catalog-tree.json`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const tree = (await res.json()) as { collections?: { category: string; collection: string; folder: string; count: number; sample: string }[] };
      if (Array.isArray(tree.collections) && tree.collections.length) {
        return NextResponse.json({ collections: tree.collections, configured, source: 'site-tree' });
      }
    }
  } catch {
    // Not published, or the site is slow: read it the older way.
  }

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
      // Folders the catalogue has nothing in yet — only for the site this list describes.
      for (const [category, list] of Object.entries(origin === KNOWN_TREE_ORIGIN ? KNOWN_TREE : {})) {
        for (const collection of list) if (!byCollection.has(collection)) byCollection.set(collection, { category, count: 0, sample: '' });
      }
      const collections = [...byCollection.entries()]
        .map(([collection, v]) => ({
          collection,
          category: v.category,
          count: v.count,
          // The path a new photo goes to — "Earrings/Jhumki".
          folder: `${v.category}/${collection}`,
          sample: v.sample ? `${origin}/catalog-thumb/${encodeURI(v.sample)}` : '',
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.collection.localeCompare(b.collection));
      return NextResponse.json({ collections, configured, source: 'catalogue' });
    }
  } catch {
    // Falls through to the known tree below. Not an error worth surfacing:
    // the catalogue file only exists once the website's own build has shipped.
  }

  // The list is taheri.shop's folders. Offered to another shop's site it would
  // send that shop's photographs into Taheri's collection names; better to say
  // the site could not be read.
  if (origin !== KNOWN_TREE_ORIGIN) {
    return NextResponse.json({ error: `Could not read the collections from ${origin}. Is the website up?` }, { status: 502 });
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
  const heic = isHeic(ext, file.type);
  if (!heic && !EXTS.includes(ext)) return NextResponse.json({ error: `Photographs must be ${[...EXTS, ...HEIC_EXTS].join(', ')}.` }, { status: 415 });

  // Keep the name the counter gave it, minus anything that would change where
  // the file lands. The site's own sanitiser is the real boundary; this is so
  // the name stays recognisable rather than being mangled there.
  let base = (nameHint || file.name).replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base || base === '.' || base === '..' || base.startsWith('.')) return NextResponse.json({ error: 'Give the photograph a name.' }, { status: 400 });

  // A HEIC becomes a JPEG of the same name before it goes anywhere.
  let body: Blob = file;
  if (heic) {
    try {
      const jpeg = await convertHeic({ buffer: new Uint8Array(await file.arrayBuffer()), format: 'JPEG', quality: 0.9 });
      body = new Blob([jpeg], { type: 'image/jpeg' });
    } catch (e) {
      console.warn('[website photos] HEIC conversion failed:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'Could not read that HEIC photograph. Export it as a JPEG and try again.' }, { status: 415 });
    }
    base = base.replace(/\.hei[cf]$/i, '') + '.jpg';
  }
  try {
    const up = await uploadToSite(body, folder, base);
    return NextResponse.json({ ok: true, ...up, uploadedBy: who });
  } catch (e) {
    if (e instanceof SiteUploadError) return NextResponse.json({ error: e.message, ...(e.detail ? { detail: e.detail } : {}) }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed' }, { status: 504 });
  }
}
