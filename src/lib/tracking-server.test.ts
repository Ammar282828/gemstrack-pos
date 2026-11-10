import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/app/api/shopify/_lib', () => ({ getShopifyCredentials: vi.fn(), shopifyRequest: vi.fn() }));
vi.mock('@/lib/tcs-payments-server', () => ({ tcsCredentials: vi.fn() }));
vi.mock('@/lib/tcs-cod-server', () => ({ tcsTrackOrder: vi.fn() }));
const { askOf } = await import('./tracking-server');

describe('askOf and cancelled bookings', () => {
  const shopify = { company: 'TCS', number: '111' };
  it('asks about the order\'s number as before', () => {
    expect(askOf({ tcsConsignmentNo: '222', shopifyTracking: shopify }).cn).toBe('222');
    expect(askOf({ shopifyTracking: shopify }).cn).toBe('111');
    expect(askOf({}).cn).toBeNull();
  });
  it('never asks about a CN listed in tcsCancelledCns, whichever field carries it', () => {
    expect(askOf({ tcsCancelledCns: ['111'], shopifyTracking: shopify }).cn).toBeNull();
    expect(askOf({ tcsCancelledCns: ['222'], tcsConsignmentNo: '222', tcsBooking: { cn: '222' } }).cn).toBeNull();
    // A different live number is still asked.
    expect(askOf({ tcsCancelledCns: ['111'], shopifyTracking: { company: 'TCS', number: '333' } }).cn).toBe('333');
  });
});
