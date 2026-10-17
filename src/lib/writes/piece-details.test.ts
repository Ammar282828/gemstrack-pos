import { beforeEach, describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { photoHash } from '@/lib/order-photos';
import { lockDatabase } from './database-lock';
import { PieceDetailsRefusal, updateInvoicePieceDetails, updateOrderPieceDetails, withOrderItemDetails } from './piece-details';

// One in-memory database behind the port. All names, ids and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

const port: DbPort = {
  async runTransaction(fn) {
    const writes: (() => void)[] = [];
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  },
  async queryEquals() { return []; },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add(c, d) { ids += 1; put(c, `${c}-${ids}`, d); return `${c}-${ids}`; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { writes.forEach((w) => w()); },
    };
  },
  newId(c) { ids += 1; return `${c}-${ids}`; },
  timestamp: (d) => d.toISOString(),
  serverTime: () => 'server-time',
};

let logged: string[][] = [];
const fx = { log: (a: string, t: string, d: string, ref?: string) => { logged.push([a, t, d, ref ?? '']); } };
const NOW = '2026-10-17T08:00:00.000Z';
const PHOTO = 'data:image/jpeg;base64,AAAA';

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  logged = [];
  put('orders', 'ORD-1', {
    customerName: 'Demo Customer', grandTotal: 90000,
    items: [
      { description: 'Demo ring', size: '12', stoneDetails: 'Old stone line', adminNote: 'Old note', estimatedWeightG: 4.2, totalEstimate: 90000, samplePhotoId: 'photo-old', samplePhotoHash: 'h-old' },
      { description: 'Demo chain', estimatedWeightG: 10 },
    ],
  });
  put('order_photos', 'photo-old', { dataUri: 'data:image/jpeg;base64,BBBB', orderId: 'ORD-1' });
  put('invoices', 'INV-1', { grandTotal: 50000, items: { 0: { name: 'Demo bangle', size: '2.4', metalWeightG: 8, itemTotal: 50000 } } });
});

describe('withOrderItemDetails', () => {
  it('changes only the karigar\'s fields, never clears the name, and removes a blank line', () => {
    const items = [{ description: 'Demo ring', size: '12', referenceSku: 'RIN-1', totalEstimate: 900 }];
    const out = withOrderItemDetails(items, 0, { description: '  ', size: '', referenceSku: ' RIN-2 ', estimatedWeightG: 3.5 });
    expect(out).toEqual([{ description: 'Demo ring', referenceSku: 'RIN-2', estimatedWeightG: 3.5, totalEstimate: 900 }]);
    expect(items[0].size).toBe('12');
  });

  it('refuses a piece that is not there', () => {
    expect(() => withOrderItemDetails([{ description: 'x' }], 3, { size: '1' })).toThrow(PieceDetailsRefusal);
  });
});

describe('updateOrderPieceDetails', () => {
  it('writes the details, moves a new picture to its own document and deletes the one it replaced', async () => {
    const out = await updateOrderPieceDetails(port, {
      orderId: 'ORD-1', itemIndex: 0, now: NOW,
      patch: { description: 'Demo ring, resized', size: '13', adminNote: 'Plate it', stoneDetails: '', diamondDetails: '', sampleImageDataUri: PHOTO },
    }, fx);
    expect(out).toEqual({ orderId: 'ORD-1', itemIndex: 0, description: 'Demo ring' });
    const items = col('orders')['ORD-1'].items as Record<string, unknown>[];
    const piece = items[0];
    expect(piece.description).toBe('Demo ring, resized');
    expect(piece.size).toBe('13');
    expect(piece.adminNote).toBe('Plate it');
    expect(piece.stoneDetails).toBeUndefined();
    expect(piece.totalEstimate).toBe(90000);
    expect(piece.sampleImageDataUri).toBeUndefined();
    expect(piece.samplePhotoHash).toBe(photoHash(PHOTO));
    const id = piece.samplePhotoId as string;
    expect(col('order_photos')[id]).toEqual({ dataUri: PHOTO, hash: photoHash(PHOTO), orderId: 'ORD-1', createdAt: NOW });
    expect(col('order_photos')['photo-old']).toBeUndefined();
    expect(items[1]).toEqual({ description: 'Demo chain', estimatedWeightG: 10 });
    expect(col('orders')['ORD-1'].grandTotal).toBe(90000);
    expect(logged).toEqual([['order.update', 'Making details updated on ORD-1', 'Demo ring', 'ORD-1']]);
  });

  it('takes the picture off', async () => {
    await updateOrderPieceDetails(port, { orderId: 'ORD-1', itemIndex: 0, patch: { sampleImageDataUri: '' } }, fx);
    const piece = (col('orders')['ORD-1'].items as Record<string, unknown>[])[0];
    expect(piece.samplePhotoId).toBeUndefined();
    expect(piece.samplePhotoHash).toBeUndefined();
    expect(col('order_photos')['photo-old']).toBeUndefined();
  });

  it('refuses an order or a piece that is gone, writing nothing', async () => {
    await expect(updateOrderPieceDetails(port, { orderId: 'ORD-9', itemIndex: 0, patch: { size: '1' } }, fx)).rejects.toThrow(PieceDetailsRefusal);
    await expect(updateOrderPieceDetails(port, { orderId: 'ORD-1', itemIndex: 5, patch: { size: '1' } }, fx)).rejects.toThrow(/no longer on the order/);
    expect(col('orders')['ORD-1'].items).toHaveLength(2);
    expect(logged).toEqual([]);
  });
});

describe('updateInvoicePieceDetails', () => {
  it('changes the name, size and instructions, never the weight, and writes a map back as a list', async () => {
    const out = await updateInvoicePieceDetails(port, { invoiceId: 'INV-1', itemIndex: 0, patch: { name: 'Demo kara', size: '', adminNote: 'Polish' } }, fx);
    expect(out).toEqual({ invoiceId: 'INV-1', itemIndex: 0, name: 'Demo bangle' });
    expect(col('invoices')['INV-1'].items).toEqual([{ name: 'Demo kara', adminNote: 'Polish', metalWeightG: 8, itemTotal: 50000 }]);
    expect(col('invoices')['INV-1'].grandTotal).toBe(50000);
    expect(logged).toEqual([['invoice.update', 'Making details updated on INV-1', 'Demo bangle', 'INV-1']]);
  });

  it('refuses an invoice that is gone', async () => {
    await expect(updateInvoicePieceDetails(port, { invoiceId: 'INV-9', itemIndex: 0, patch: { size: '1' } }, fx)).rejects.toThrow(/No such invoice/);
  });
});

describe('lockDatabase', () => {
  it('sets the lock over the settings, touching nothing else, and logs who', async () => {
    put('app_settings', 'global', { shopName: 'Demo Jewellers', databaseLocked: false });
    expect(await lockDatabase(port, { by: 'Demo Owner', at: NOW }, fx)).toEqual({ locked: true, at: NOW });
    expect(col('app_settings')['global']).toEqual({ shopName: 'Demo Jewellers', databaseLocked: true });
    expect(logged).toEqual([['settings.lock', 'Database locked', 'Emergency lock by Demo Owner', 'global']]);
  });
});
