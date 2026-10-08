import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkApnsKey, keyIdFromFileName, normalizeP8, openKey, sealKey } from './apns-key';
import { apnsJwt, apnsPayload } from './apns';
import { kindOfDoc } from './send';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const middle = pem.split('\n').filter((l) => l && !l.startsWith('-----')).join('\n');

describe('the Apple push key', () => {
  it('is read however it was pasted', () => {
    for (const raw of [pem, pem.replace(/\n/g, '\r\n'), middle, middle.replace(/\n/g, ''), Buffer.from(pem).toString('base64')]) {
      expect(checkApnsKey({ p8: normalizeP8(raw), keyId: 'ABCDE12345', teamId: 'TND272ULB5' })).toBeNull();
    }
    expect(normalizeP8('')).toBe('');
  });
  it('takes its ID from Apple\'s file name', () => {
    expect(keyIdFromFileName('AuthKey_ab12CD34ef.p8')).toBe('AB12CD34EF');
    expect(keyIdFromFileName('key.p8')).toBe('');
  });
  it('refuses what is not one', () => {
    expect(checkApnsKey({ p8: 'nonsense', keyId: 'ABCDE12345', teamId: 'TND272ULB5' })).toMatch(/not a readable/);
    expect(checkApnsKey({ p8: pem, keyId: 'short', teamId: 'TND272ULB5' })).toMatch(/key ID/);
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(checkApnsKey({ p8: rsa, keyId: 'ABCDE12345', teamId: 'TND272ULB5' })).toMatch(/not an Apple push key/);
  });
  it('is kept sealed and opens only with the same secret', () => {
    const sealed = sealKey({ p8: pem, keyId: 'ABCDE12345', teamId: 'TND272ULB5' }, 'cron-secret', 'owner@example.com');
    expect(sealed.data).not.toContain('PRIVATE');
    expect(JSON.stringify(sealed)).not.toContain(middle.slice(0, 20));
    expect(openKey(sealed, 'cron-secret')?.p8).toBe(pem);
    expect(openKey(sealed, 'another secret')).toBeNull();
  });
});

describe('what goes to Apple', () => {
  it('signs a provider token Apple can check', () => {
    const jwt = apnsJwt({ p8: pem, keyId: 'ABCDE12345', teamId: 'TND272ULB5' }, Date.UTC(2026, 9, 8));
    const [h, b, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'ABCDE12345' });
    expect(JSON.parse(Buffer.from(b, 'base64url').toString())).toEqual({ iss: 'TND272ULB5', iat: Date.UTC(2026, 9, 8) / 1000 });
    expect(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
  });
  it('carries the page to open beside the alert', () => {
    expect(apnsPayload({ title: 'Payment received', body: 'INV-000083 · PKR 25,000', url: '/invoices/INV-000083', thread: 'payments' })).toEqual({
      aps: { alert: { title: 'Payment received', body: 'INV-000083 · PKR 25,000' }, sound: 'default', 'thread-id': 'payments' },
      url: '/invoices/INV-000083',
    });
  });
  it('sorts the WhatsApp alerts into the phone\'s kinds', () => {
    expect(kindOfDoc({ kind: 'sale' })).toBe('sales');
    expect(kindOfDoc({ kind: 'online-slip' })).toBe('payments');
    expect(kindOfDoc({ kind: 'website-order' })).toBe('orders');
    expect(kindOfDoc({ kind: 'order-completed' })).toBe('orders');
    expect(kindOfDoc({ kind: 'daily-report' })).toBeNull();
  });
});
