import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { paletteFor } from '@/lib/nav';
import { nativeVoicePlan } from '@/lib/voice/native-plan';
import type { Book } from '@/lib/voice/args';
import type { HisaabEntry } from '@/lib/store';
import { DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL } from '@/lib/pricing';
import { POST as listen } from '../listen/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOK_NAMES = ['customers', 'karigars', 'orders', 'invoices', 'repairs', 'products', 'given_items', 'karigar_jobs', 'expenses', 'additional_revenue', 'hisaab', 'voice_aliases'] as const;
type Loaded = { rows: Record<(typeof BOOK_NAMES)[number], any[]>; settings: Record<string, any> };

/** The book is a dozen whole collections, so a person dictating several lines in a minute would read them all
 * each time. Kept 45 s per instance and per project (the two houses never share a server, but a key costs nothing).
 * A line spoken just after a save may name the old book; the phone still sends only planned ops to /api/app/write,
 * which checks against the live data. */
const BOOK_TTL_MS = 45_000;
const books = new Map<string, { at: number; loaded: Promise<Loaded> }>();

async function loadBook(): Promise<Loaded> {
  const key = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'default';
  const hit = books.get(key);
  if (hit && Date.now() - hit.at < BOOK_TTL_MS) return hit.loaded;
  const loaded = (async (): Promise<Loaded> => {
    const snapshots = await Promise.all(BOOK_NAMES.map(n => adminDb.collection(n).get()));
    const rows = Object.fromEntries(BOOK_NAMES.map((name, i) => [name, snapshots[i].docs.map(d => ({ ...d.data(), id: d.id })).filter((d: any) => !d.deletedAt)])) as Loaded['rows'];
    const settings = (await adminDb.collection('app_settings').doc('global').get()).data() ?? {};
    return { rows, settings };
  })();
  books.set(key, { at: Date.now(), loaded });
  // A failed read must not be served for 45 s.
  loaded.catch(() => { if (books.get(key)?.loaded === loaded) books.delete(key); });
  return loaded;
}

/** Authenticated owners only, just like listen. Book data is loaded here rather
 * than accepting names, balances or candidate records from the phone. No writes. */
export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'Not available on this account.' }, { status: 403 });
  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return NextResponse.json({ error: 'Could not read the request.' }, { status: 400 }); }
  if (!input || Array.isArray(input) || typeof input !== 'object') return NextResponse.json({ error: 'A sentence is needed.' }, { status: 400 });
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const audio = typeof input.audio === 'string' ? input.audio : '';
  if ((!text && !audio) || text.length > 4000 || audio.length > 12_000_000) return NextResponse.json({ error: 'Use a sentence or a recording of up to one minute.' }, { status: 400 });
  try {
    const { rows, settings } = await loadBook();
    const destinations = paletteFor('owner').map(d => ({ label: d.label, href: d.href, keywords: d.keywords }));
    const roster = [...rows.customers.map((c: any) => ({ id: c.id, name: c.name, kind: 'customer' })), ...rows.karigars.map((k: any) => ({ id: k.id, name: k.name, kind: 'karigar' }))];
    const aliases = new Map(rows.voice_aliases.map((a: any) => [a.heardKey, { kind: a.kind, id: a.refId }]));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const book = { ...rows, roster, aliases, givenItems: rows.given_items, karigarJobs: rows.karigar_jobs,
      extraRevenues: rows.additional_revenue, destinations, today } as unknown as Book;
    const { documentsFor } = await import('@/lib/voice/documents');
    const response = await listen(new NextRequest(req.url.replace(/\/native$/, '/listen'), {
      method: 'POST', headers: req.headers,
      body: JSON.stringify({ ...(audio ? { audio, mimeType: 'audio/mp4' } : { text }), roster,
        documents: documentsFor(book.orders, book.invoices), shopName: settings.shopName, today,
        orderKarat: DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL.replace('k', ''), screens: destinations.map(d => d.label) }),
    }));
    const raw = await response.json();
    if (!response.ok) return NextResponse.json(raw, { status: response.status });
    return NextResponse.json(await nativeVoicePlan(raw, book, settings, rows.hisaab as unknown as HisaabEntry[]), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[/api/voice/native]', error);
    return NextResponse.json({ error: 'Could not read the shop’s book. Please try again.' }, { status: 500 });
  }
}
