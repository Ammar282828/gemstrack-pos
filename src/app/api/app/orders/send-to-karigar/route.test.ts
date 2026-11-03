/**
 * Send to karigar never reaches WhatsApp twice (owner, 2026-11-03: "it keeps retrying or double sending").
 * Firestore and WhatsApp are stand-ins; the route's own record of each send (`karigar_sends`) is what is tested.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PX = 'data:image/png;base64,iVBORw0KGgo=';
const store = new Map<string, Record<string, unknown>>();
const sends: string[] = [];
let failNext: Error | null = null;
let clock = 1_000_000;
let txQueue: Promise<unknown> = Promise.resolve();

const arrayUnion = (...v: string[]) => ({ __union: v });
const increment = (n: number) => ({ __inc: n });
function apply(path: string, patch: Record<string, unknown>) {
  const cur = { ...(store.get(path) ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && '__union' in v) cur[k] = [...new Set([...((cur[k] as string[]) ?? []), ...(v as { __union: string[] }).__union])];
    else if (v && typeof v === 'object' && '__inc' in v) cur[k] = ((cur[k] as number) ?? 0) + (v as { __inc: number }).__inc;
    else cur[k] = v;
  }
  store.set(path, cur);
}
const doc = (path: string) => ({
  path,
  get: async () => { const d = store.get(path); return { exists: !!d, id: path.split('/').pop(), data: () => d, get: (f: string) => d?.[f] }; },
  set: async (d: Record<string, unknown>) => { store.set(path, { ...d }); },
  update: async (p: Record<string, unknown>) => apply(path, p),
});

vi.mock('firebase-admin/firestore', () => ({ FieldValue: { arrayUnion, increment } }));
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({ doc: (id: string) => doc(`${c}/${id}`), add: async () => ({}) }),
    doc: (p: string) => doc(p),
    // Firestore runs one transaction on a document at a time (it retries the loser): a queue here.
    runTransaction: <T,>(fn: (tx: unknown) => Promise<T>) => (txQueue = txQueue.then(() => fn({
      get: (r: { get: () => Promise<unknown> }) => r.get(),
      set: (r: { path: string }, d: Record<string, unknown>) => store.set(r.path, { ...d }),
      update: (r: { path: string }, p: Record<string, unknown>) => apply(r.path, p),
    }))) as Promise<T>,
  },
}));
vi.mock('@/lib/app-pdf', () => ({ pdfViewer: async () => ({ email: 'owner@shop', role: 'owner' }), isDocId: (s: string) => !!s }));
vi.mock('@/lib/daily-cap', () => ({ dailyCap: async () => null, WHATSAPP_PER_DAY: 999 }));
vi.mock('@/lib/order-photos-server', () => ({ readOrderPhotos: async () => new Map() }));
vi.mock('@/lib/order-photos', () => ({ itemPhotoRefs: (it: { pics?: number }) => Array.from({ length: it?.pics ?? 0 }, () => ({ src: PX })) }));
vi.mock('@/lib/whatsapp', () => ({
  whatsAppProvider: () => 'waha',
  toWhatsAppNumber: (s: string) => s.replace(/\D/g, ''),
  sendWhatsAppFile: async (_to: string, _b: Blob, _n: string, caption: string) => {
    clock += 5_000;
    if (failNext) { const e = failNext; failNext = null; throw e; }
    sends.push(`photo:${/\*(.+?)\*/.exec(caption)?.[1] ?? (caption ? caption.split('\n')[0] : '-')}`);
  },
  sendWhatsAppMessage: async (_to: string, body: string) => { clock += 1_000; sends.push(`text:${body.split('\n')[0]}`); },
}));

const { POST } = await import('./route');
const call = async (body: Record<string, unknown> = {}) => {
  const res = await POST({ json: async () => ({ orderId: 'ORD-1', karigarId: 'k1', ...body }) } as never);
  return { status: res.status, ...(await res.json()) } as Record<string, unknown>;
};

beforeEach(() => {
  store.clear(); sends.length = 0; failNext = null; clock = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  store.set('karigars/k1', { name: 'Usman', contact: '0300 1234567' });
  store.set('orders/ORD-1', {
    items: [
      { description: 'Ring', karat: '21k', metalType: 'gold', karigarId: 'k1', pics: 2 },
      { description: 'Pendant', karat: '21k', metalType: 'gold', karigarId: 'k1', pics: 1 },
    ],
  });
});

describe('send to karigar, once', () => {
  it('sends each piece once: the photo with its words, then any more photos bare', async () => {
    const r = await call();
    expect(r).toMatchObject({ ok: true, sent: 3 });
    expect(sends).toEqual(['photo:Ring', 'photo:-', 'photo:Pendant']);
  });

  it('a second tap, or Retry after it went, sends nothing and says so', async () => {
    await call();
    clock += 30_000;
    const again = await call();
    expect(again).toMatchObject({ ok: true, duplicate: true, sent: 3 });
    expect(String(again.said)).toMatch(/Already sent to Usman/);
    expect(sends).toHaveLength(3);
  });

  it('the same send while one is running is not started twice', async () => {
    store.set('karigar_sends/x', {});
    const first = call();
    const second = await call();
    await first;
    expect(second).toMatchObject({ duplicate: true, busy: true, sent: 0 });
    expect(sends).toHaveLength(3);
  });

  it('after a failure, Retry sends only what had not gone', async () => {
    // The ring's first photo is refused (not a timeout): the rest goes, and the ring's words ride its next photo.
    failNext = new Error('refused by WAHA');
    const first = await call();
    expect(first.photosFailed).toBe(1);
    expect(sends).toEqual(['photo:Ring', 'photo:Pendant']);
    clock += 10_000;
    const retry = await call();
    expect(retry).toMatchObject({ ok: true, sent: 1 });
    expect(sends).toEqual(['photo:Ring', 'photo:Pendant', 'photo:-']);
    // And now it has all gone: a third tap sends nothing.
    clock += 10_000;
    expect(await call()).toMatchObject({ duplicate: true });
    expect(sends).toHaveLength(3);
  });

  it('a WhatsApp timeout is never sent again: it may have gone', async () => {
    failNext = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const r = await call();
    expect(r).toMatchObject({ ok: true, unsure: 1 });
    clock += 200_000;
    const later = await call();
    // Two minutes on, the same words are a new send by intent: everything goes again, which is the person asking.
    expect(later.duplicate).toBeUndefined();
  });

  it('a long send answers partial and the next request carries on without repeating', async () => {
    (store.get('orders/ORD-1')!.items as { pics: number }[])[0].pics = 9;
    const a = await call();
    expect(a.partial).toBe(true);
    const firstRound = [...sends];
    const b = await call();
    expect(b.partial).toBeUndefined();
    expect(sends.slice(0, firstRound.length)).toEqual(firstRound);
    expect(sends).toHaveLength(10);
    expect(sends.filter(s => s === 'photo:Ring')).toHaveLength(1);
    expect(sends.filter(s => s === 'photo:Pendant')).toHaveLength(1);
  });

  it('different words are a different send', async () => {
    await call();
    await call({ texts: { 0: 'Make it lighter' } });
    expect(sends).toHaveLength(6);
  });
});
