import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const docs: Record<string, Record<string, unknown> | undefined> = {};
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({ doc: (id: string) => ({ get: async () => ({ data: () => docs[`${c}/${id}`], exists: !!docs[`${c}/${id}`] }) }) }),
  },
}));
vi.mock('@/lib/website/ratelimit', () => ({ rateLimit: async () => ({ ok: true }), callerKey: () => 'test' }));

const { GET } = await import('./route');
const KEY = 'Abcdefghijklmnopqrstuvwx';
const call = (id: string, t?: string) =>
  GET(new NextRequest(`https://erp.taheri.shop/api/public/invoice/${id}${t === undefined ? '' : `?t=${t}`}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const k of Object.keys(docs)) delete docs[k];
  docs['invoices/INV-000123'] = {
    customerName: 'Sakina', customerId: 'c1', grandTotal: 100_000, shareToken: KEY, internalNote: 'resize pending',
    items: [{ name: 'Ring', itemTotal: 100_000, adminNote: 'from old stock', karigarId: 'k9', givenAt: 'x', isCompleted: true }],
  };
  docs['customers/c1'] = { name: 'Sakina', phone: '0300', address: 'Block 5, Clifton' };
  docs['app_settings/global'] = { shopName: 'Taheri', notifPhones: ['923000000000'] };
});

describe('a customer\'s invoice link', () => {
  it('opens with its key: the invoice, the address for the PDF, the shop\'s name — nothing of the shop\'s own', async () => {
    const res = await call('INV-000123', KEY);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.invoice).toMatchObject({ id: 'INV-000123', customerName: 'Sakina', grandTotal: 100_000 });
    expect(d.invoice.internalNote).toBeUndefined();
    expect(d.invoice.shareToken).toBeUndefined();
    expect(d.invoice.items[0]).toEqual({ name: 'Ring', itemTotal: 100_000 });
    expect(d.customer).toEqual({ address: 'Block 5, Clifton' });
    expect(d.shopName).toBe('Taheri');
    expect(JSON.stringify(d)).not.toContain('923000000000');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('opens nothing by number alone, with a wrong key, or for an invoice that has no key', async () => {
    expect((await call('INV-000123')).status).toBe(404);
    expect((await call('INV-000123', 'Zbcdefghijklmnopqrstuvwx')).status).toBe(404);
    expect((await call('INV-000124', KEY)).status).toBe(404);
    delete (docs['invoices/INV-000123'] as Record<string, unknown>).shareToken;
    expect((await call('INV-000123', KEY)).status).toBe(404);
  });
});
