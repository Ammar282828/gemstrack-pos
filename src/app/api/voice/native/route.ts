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
    const names = ['customers', 'karigars', 'orders', 'invoices', 'repairs', 'products', 'given_items', 'karigar_jobs', 'expenses', 'additional_revenue', 'hisaab', 'voice_aliases'] as const;
    const snapshots = await Promise.all(names.map(n => adminDb.collection(n).get()));
    const rows = Object.fromEntries(names.map((name, i) => [name, snapshots[i].docs.map(d => ({ ...d.data(), id: d.id })).filter((d: any) => !d.deletedAt)]));
    const settings = (await adminDb.collection('app_settings').doc('global').get()).data() ?? {};
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
