import { describe, expect, it } from 'vitest';
import { droppedPhotoIds, itemPhotoRef, photoHash, splitItemPhotos } from './order-photos';

describe('order photos out of the order', () => {
  it('moves inline photos to their own documents and leaves URLs and moved photos alone', () => {
    let n = 0;
    const { items, photos } = splitItemPhotos([
      { description: 'Ring', sampleImageDataUri: 'data:image/jpeg;base64,AAA' },
      { description: 'Stock piece', sampleImageDataUri: 'https://cdn/x.jpg' },
      { description: 'Moved', samplePhotoId: 'photo-old' },
      { description: 'None' },
    ], () => `p${++n}`);
    expect(photos).toEqual([{ id: 'p1', dataUri: 'data:image/jpeg;base64,AAA', hash: photoHash('data:image/jpeg;base64,AAA') }]);
    expect(items).toEqual([
      { description: 'Ring', samplePhotoId: 'p1', samplePhotoHash: photoHash('data:image/jpeg;base64,AAA') },
      { description: 'Stock piece', sampleImageDataUri: 'https://cdn/x.jpg' },
      { description: 'Moved', samplePhotoId: 'photo-old' },
      { description: 'None' },
    ]);
  });
  it('a new photo replaces the old id', () => {
    const { items } = splitItemPhotos([{ samplePhotoId: 'photo-old', sampleImageDataUri: 'data:x' }], () => 'p-new');
    expect(items).toEqual([{ samplePhotoId: 'p-new', samplePhotoHash: photoHash('data:x') }]);
  });
  it('readers take either shape', () => {
    expect(itemPhotoRef({ sampleImageDataUri: 'data:x' })).toEqual({ src: 'data:x' });
    expect(itemPhotoRef({ samplePhotoId: 'p1' })).toEqual({ id: 'p1' });
    expect(itemPhotoRef({})).toEqual({});
  });
});

describe('saving an edited order twice (photos are idempotent)', () => {
  const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(500);
  let n = 0;
  const mk = () => `p${++n}`;

  /** The phone's old behaviour: every save re-sends the stored item's inline copy; the commit writes what split says. */
  function save(order: { items: Record<string, unknown>[] }, photoDocs: Record<string, unknown>, send: Record<string, unknown>[]) {
    const { items, photos, replaced } = splitItemPhotos(send as never[], mk);
    for (const p of photos) photoDocs[p.id] = { dataUri: p.dataUri, hash: p.hash };
    for (const id of replaced) delete photoDocs[id];
    order.items = items;
  }

  it('an unchanged data URI beside an existing photo id adds no document and keeps the id', () => {
    const docs: Record<string, unknown> = { 'photo-old': { dataUri: PHOTO } };
    const order = { items: [{ description: 'Ring', samplePhotoId: 'photo-old' }] as Record<string, unknown>[] };
    // First save from a client that holds the bytes but no hash (a document filed before hashes existed): replaced once.
    save(order, docs, [{ ...order.items[0], sampleImageDataUri: PHOTO }]);
    expect(Object.keys(docs)).toHaveLength(1);
    // Every later save re-sends the same bytes: nothing new.
    const id = order.items[0].samplePhotoId;
    for (let i = 0; i < 3; i++) save(order, docs, [{ ...order.items[0], sampleImageDataUri: PHOTO }]);
    expect(Object.keys(docs)).toHaveLength(1);
    expect(order.items[0].samplePhotoId).toBe(id);
    expect(order.items[0].sampleImageDataUri).toBeUndefined();
  });

  it('a different picture replaces the document instead of orphaning it', () => {
    const docs: Record<string, unknown> = {};
    const order = { items: [] as Record<string, unknown>[] };
    save(order, docs, [{ description: 'Ring', sampleImageDataUri: PHOTO }]);
    save(order, docs, [{ ...order.items[0], sampleImageDataUri: PHOTO + 'B' }]);
    expect(Object.keys(docs)).toHaveLength(1);
  });

  it('droppedPhotoIds names what an edit let go of', () => {
    expect(droppedPhotoIds([{ samplePhotoId: 'a' }, { samplePhotoId: 'b' }, {}], [{ samplePhotoId: 'b' }])).toEqual(['a']);
  });
  it('the hash tells pictures apart', () => {
    expect(photoHash(PHOTO)).toBe(photoHash(PHOTO));
    expect(photoHash(PHOTO)).not.toBe(photoHash(PHOTO + 'B'));
  });
});
