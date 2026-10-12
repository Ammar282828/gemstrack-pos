import { describe, expect, it } from 'vitest';
import { clampSwipe, dateLeafParts, initials, moneySplit, settleSwipe, stageIndex } from './helpers';
import { toneClasses } from './tone';
import { contactHrefs } from './quick-actions';
import { formatAmount } from './money';
import { toneClass } from '@/lib/utils';

describe('initials', () => {
  it('takes first and last word', () => {
    expect(initials('Ayesha Khan')).toBe('AK');
    expect(initials('  muhammad  ali  raza ')).toBe('MR');
    expect(initials('Zara')).toBe('Z');
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
  });
});

describe('moneySplit', () => {
  it('owing', () => {
    const s = moneySplit(1000, 400);
    expect(s).toMatchObject({ state: 'due', amount: 600, paidInFull: false });
    expect(s.fraction).toBeCloseTo(0.4);
  });
  it('credit when overpaid', () => {
    expect(moneySplit(1000, 1200)).toMatchObject({ state: 'credit', amount: 200, fraction: 1, paidInFull: true });
  });
  it('nil when settled, and under half a rupee', () => {
    expect(moneySplit(1000, 1000).state).toBe('nil');
    expect(moneySplit(1000, 999.7).state).toBe('nil');
  });
  it('an explicit due wins', () => {
    expect(moneySplit(1000, 1000, 50).state).toBe('due');
  });
});

describe('stageIndex', () => {
  it('numbers clamp, names match, unknown is 0', () => {
    expect(stageIndex(2)).toBe(2);
    expect(stageIndex(9)).toBe(3);
    expect(stageIndex(-1)).toBe(0);
    expect(stageIndex('ready')).toBe(2);
    expect(stageIndex('nope')).toBe(0);
  });
});

describe('dateLeafParts', () => {
  it('reads weekday, day, month', () => {
    expect(dateLeafParts(new Date(2026, 9, 12))).toEqual({ weekday: 'MON', day: '12', month: 'OCT' });
    expect(dateLeafParts('garbage')).toBeNull();
  });
});

describe('swipe', () => {
  it('gives a little past the actions, never more than 24px', () => {
    expect(clampSwipe(50, 0, 76)).toBe(50);
    expect(clampSwipe(1000, 0, 76)).toBe(76 + 24);
    expect(clampSwipe(-10, 0, 76)).toBeLessThan(0.0001 + 24); // no leading actions: bounded give
  });
  it('settles open past half, closed before it, and never fires', () => {
    expect(settleSwipe(50, 0, 0, 76)).toBe(76);
    expect(settleSwipe(30, 0, 0, 76)).toBe(0);
    expect(settleSwipe(-100, 0, 152, 0)).toBe(-152);
    expect(settleSwipe(10, 0.6, 0, 76)).toBe(76);
    expect(settleSwipe(70, -0.6, 0, 76)).toBe(0);
  });
});

describe('Pill tone classes', () => {
  it('map to ink and tint', () => {
    expect(toneClasses('owed')).toMatchObject({ ink: 'text-tone-owed-ink', tint: 'bg-tone-owed/[.13]' });
    expect(toneClasses('quiet').ink).toBe('text-muted-foreground');
    expect(toneClass('late')).toBe('text-tone-late-ink');
  });
});

describe('money display', () => {
  it('uses lac/crore when asked, exact rupees otherwise', () => {
    expect(formatAmount(450000, true)).toBe('4.5 lac');
    expect(formatAmount(85000, true)).toBe('85,000');
    expect(formatAmount(1234567.4)).toBe('1,234,567');
  });
});

describe('contactHrefs', () => {
  it('builds tel, wa.me and sms; nothing without a number', () => {
    expect(contactHrefs('0300 1234567')).toEqual({ tel: 'tel:03001234567', whatsapp: 'https://wa.me/923001234567', sms: 'sms:03001234567' });
    expect(contactHrefs('')).toBeNull();
    expect(contactHrefs(undefined)).toBeNull();
  });
});
