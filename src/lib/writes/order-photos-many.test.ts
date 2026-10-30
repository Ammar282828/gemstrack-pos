import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { createOrder } from './create-order';
import { updateOrder } from './update-order';
import { updateOrderPieceDetails } from './piece-details';
import { MAX_PIECE_PHOTOS, droppedPhotoIds, itemPhotoRefs, photoHash, splitItemPhotos } from '@/lib/order-photos';

/** In-memory database that counts commits (one transaction = one trip). */
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  let commits = 0;
  const db = {
    async runTransaction(fn: (tx: TxCtx) => Promise<unknown>) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      commits++;
      return out;
    },
    async get(c: string, id: string) { const d = col(c)[id]; return d ? { ...d, id } : null; },
  } as unknown as DbPort;
  return { db, data, commits: () => commits };
}

const photo = (n: number) => `data:image/jpeg;base64,${'A'.repeat(300)}${n}`;
const clean = <T extends object>(o: T) => JSON.parse(JSON.stringify(o)) as T;
const seed = { app_settings: { global: { lastOrderNumber: 4, goldRatePerGram21k: 1 } } };

describe('several reference photos per piece', () => {
  it('createOrder writes the order and one document per photo in ONE commit, with the old field set for the first', async () => {
    const { db, data, commits } = fakeDb(seed);
    const before = commits();
    const order = await createOrder(db, {
      items: [{ description: 'Ring', sampleImageDataUri: photo(1), extraPhotos: [{ dataUri: photo(2) }, { dataUri: photo(3) }] } as never],
      customerName: 'X',
    }, { createCustomer: async () => ({ id: 'c1', name: 'X' }), clean });
    expect(commits() - before).toBe(1);
    const item = (data.orders[order.id].items as Record<string, unknown>[])[0] as { samplePhotoId: string; sampleImageDataUri?: string; extraPhotos: { id: string; hash: string }[] };
    // The first photo is where every older reader looks; nothing inline stays on the order.
    expect(item.samplePhotoId).toBeTruthy();
    expect(item.sampleImageDataUri).toBeUndefined();
    expect(item.extraPhotos).toHaveLength(2);
    expect(JSON.stringify(data.orders[order.id])).not.toContain('AAAA');
    const docs = Object.entries(data.order_photos);
    expect(docs).toHaveLength(3);
    expect(data.order_photos[item.samplePhotoId].dataUri).toBe(photo(1));
    expect(data.order_photos[item.extraPhotos[1].id]).toMatchObject({ dataUri: photo(3), orderId: order.id });
  });

  it('a piece with one photo (any older order) reads as a list of one; more are listed in order', () => {
    expect(itemPhotoRefs({ samplePhotoId: 'p1' })).toEqual([{ id: 'p1' }]);
    expect(itemPhotoRefs({ sampleImageDataUri: 'https://x/y.jpg' })).toEqual([{ src: 'https://x/y.jpg' }]);
    expect(itemPhotoRefs({})).toEqual([]);
    expect(itemPhotoRefs({ samplePhotoId: 'p1', extraPhotos: [{ id: 'p2' }, { id: 'p3' }] })).toEqual([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
  });

  it('caps a piece at MAX_PIECE_PHOTOS and drops empty entries', () => {
    const extras = Array.from({ length: 12 }, (_, i) => ({ dataUri: photo(i) }));
    const { items, photos } = splitItemPhotos([{ sampleImageDataUri: photo(99), extraPhotos: [{}, ...extras] }]);
    expect(items[0].extraPhotos).toHaveLength(MAX_PIECE_PHOTOS - 1);
    expect(photos).toHaveLength(MAX_PIECE_PHOTOS);
  });

  it('an edit that re-sends stored photos writes nothing new; an added one is one new document; a removed one is deleted', async () => {
    const { db, data, commits } = fakeDb({
      ...seed,
      orders: { 'ORD-1': { id: 'ORD-1', status: 'Pending', items: [{ description: 'Ring', samplePhotoId: 'a', samplePhotoHash: photoHash(photo(1)), extraPhotos: [{ id: 'b', hash: photoHash(photo(2)) }, { id: 'c' }] }] } },
      order_photos: { a: { dataUri: photo(1) }, b: { dataUri: photo(2) }, c: { dataUri: photo(3) } },
    });
    const stored = (data.orders['ORD-1'].items as Record<string, unknown>[])[0];
    // The form re-sends everything as stored, drops "c" and adds a new one.
    const before = commits();
    await updateOrder(db, { orderId: 'ORD-1', edit: { items: [{ ...stored, extraPhotos: [{ id: 'b', hash: photoHash(photo(2)) }, { dataUri: photo(4) }] }] } }, { clean });
    expect(commits() - before).toBe(1);
    const item = (data.orders['ORD-1'].items as Record<string, unknown>[])[0] as { samplePhotoId: string; extraPhotos: { id: string }[] };
    expect(item.samplePhotoId).toBe('a');
    expect(item.extraPhotos[0].id).toBe('b');
    expect(Object.keys(data.order_photos).sort()).toEqual(['a', 'b', item.extraPhotos[1].id].sort());
    expect(data.order_photos.c).toBeUndefined();
    // Sending the same bytes again beside a known id (an unhashed old document) adds nothing.
    const again = (data.orders['ORD-1'].items as Record<string, unknown>[])[0];
    await updateOrder(db, { orderId: 'ORD-1', edit: { items: [{ ...again, sampleImageDataUri: photo(1) }] } }, { clean });
    expect(Object.keys(data.order_photos)).toHaveLength(3);
  });

  it('with the first picture taken off, the next one becomes the main one (older readers look there)', () => {
    const { items, photos } = splitItemPhotos([
      { sampleImageDataUri: undefined, samplePhotoId: undefined, extraPhotos: [{ id: 'b', hash: 'hb' }, { dataUri: photo(7) }] },
    ], () => 'new');
    expect(items[0]).toEqual({ samplePhotoId: 'b', samplePhotoHash: 'hb', extraPhotos: [{ id: 'new', hash: photoHash(photo(7)) }] });
    expect(photos).toHaveLength(1);
  });

  it('droppedPhotoIds counts the extras', () => {
    expect(droppedPhotoIds([{ samplePhotoId: 'a', extraPhotos: [{ id: 'b' }, { id: 'c' }] }], [{ samplePhotoId: 'a', extraPhotos: [{ id: 'c' }] }])).toEqual(['b']);
  });

  it('the Workshop details write replaces the extras but cannot adopt another order\'s document', async () => {
    const { db, data } = fakeDb({
      orders: { 'ORD-1': { items: [{ description: 'Ring', samplePhotoId: 'a', extraPhotos: [{ id: 'b' }, { id: 'c' }] }] } },
      order_photos: { a: { dataUri: photo(1) }, b: { dataUri: photo(2) }, c: { dataUri: photo(3) } },
    });
    await updateOrderPieceDetails(db, { orderId: 'ORD-1', itemIndex: 0, patch: { extraPhotos: [{ id: 'b' }, { id: 'stranger' }, { dataUri: photo(5) }] } });
    const item = (data.orders['ORD-1'].items as Record<string, unknown>[])[0] as { extraPhotos: { id: string }[] };
    expect(item.extraPhotos).toHaveLength(2);
    expect(item.extraPhotos[0].id).toBe('b');
    expect(data.order_photos.c).toBeUndefined();
    expect(data.order_photos.a).toBeDefined();
  });

  describe('an edit from an app that does not know extraPhotos', () => {
    const base = () => fakeDb({
      ...seed,
      orders: { 'ORD-1': { id: 'ORD-1', status: 'Pending', items: [{ description: 'Ring', samplePhotoId: 'a', extraPhotos: [{ id: 'b' }, { id: 'c' }] }] } },
      order_photos: { a: { dataUri: photo(1) }, b: { dataUri: photo(2) }, c: { dataUri: photo(3) } },
    });

    it('keeps the extras and deletes no document when the field is missing', async () => {
      const { db, data } = base();
      await updateOrder(db, { orderId: 'ORD-1', edit: { items: [{ description: 'Ring', samplePhotoId: 'a', size: '7' }] } }, { clean });
      const item = (data.orders['ORD-1'].items as Record<string, unknown>[])[0] as { size: string; extraPhotos: { id: string }[] };
      expect(item.size).toBe('7');
      expect(item.extraPhotos.map(e => e.id)).toEqual(['b', 'c']);
      expect(Object.keys(data.order_photos).sort()).toEqual(['a', 'b', 'c']);
    });

    it('an explicit [] removes them and deletes their documents', async () => {
      const { db, data } = base();
      await updateOrder(db, { orderId: 'ORD-1', edit: { items: [{ description: 'Ring', samplePhotoId: 'a', extraPhotos: [] }] } }, { clean });
      expect((data.orders['ORD-1'].items as Record<string, unknown>[])[0].extraPhotos).toBeUndefined();
      expect(Object.keys(data.order_photos)).toEqual(['a']);
    });

    it('the Workshop details write without extraPhotos leaves them and their documents', async () => {
      const { db, data } = base();
      await updateOrderPieceDetails(db, { orderId: 'ORD-1', itemIndex: 0, patch: { size: '8' } });
      expect(Object.keys(data.order_photos).sort()).toEqual(['a', 'b', 'c']);
      expect(((data.orders['ORD-1'].items as Record<string, unknown>[])[0] as { extraPhotos: unknown[] }).extraPhotos).toHaveLength(2);
    });
  });
});
