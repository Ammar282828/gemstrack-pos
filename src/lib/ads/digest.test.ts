import { describe, expect, it } from 'vitest';
import { buildAdsDigest, digestRanges } from './digest';
import { pacing } from './attention';
import { metricsOf, type AdsAccount } from './shape';

const account: AdsAccount = { id: '1', name: 'Taheri Collections', currency: 'PKR', timezone: 'Asia/Karachi', status: 1, disableReason: 0, amountSpent: 0, spendCap: null, balance: 0, minDailyBudget: null, funding: null, businessName: null };
const m = (spend: number, chats: number, reach = 3000) => metricsOf({ spend: String(spend), impressions: String(reach * 2), reach: String(reach), clicks: '40', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(chats) }] });

describe('buildAdsDigest', () => {
  it('reads like a morning line: spend against the week, chats and their cost, the month’s pace, what needs a look', () => {
    const text = buildAdsDigest({
      shop: 'TAHERI', account, yesterday: m(2400, 6), weekBefore: m(14000, 28), month: pacing(27000, 50000, new Date('2026-09-27T12:00:00')),
      topAd: { name: 'Emerald jhumkas', metrics: m(1500, 4), goal: 'CONVERSATIONS' },
      attention: [{ kind: 'wasting', severity: 'bad', target: null, title: 'Rs 2,400 spent, no chats started: Lookalike', why: '' }, { kind: 'ending-soon', severity: 'tip', target: null, title: 'Ends today: Kara', why: '' }],
      erpUrl: 'https://erp.taheri.shop', date: 'Sat 26 Sep',
    });
    expect(text).toContain('📣 *TAHERI — Ads yesterday* (Sat 26 Sep)');
    expect(text).toContain('Spent *Rs 2,400* (+20% vs the week)');
    expect(text).toContain('Chats started: *6* (+50% vs the week) · Rs 400 each');
    expect(text).toContain('Best ad: Emerald jhumkas — Rs 1,500, 4 chats started');
    expect(text).toContain('This month: Rs 27,000 so far, heading for ~Rs 30,000 (last month Rs 50,000)');
    expect(text).toContain('🔴 Rs 2,400 spent, no chats started: Lookalike');
    expect(text).not.toContain('Ends today');
    expect(text.trim().endsWith('https://erp.taheri.shop/ads')).toBe(true);
  });
  it('says so when nothing ran', () => {
    const text = buildAdsDigest({ shop: 'MINA', account, yesterday: m(0, 0, 0), weekBefore: m(0, 0, 0), month: pacing(0, 0, new Date('2026-09-27T12:00:00')), topAd: null, attention: [], erpUrl: 'https://erp.houseofmina.store', date: 'Fri 26 Sep' });
    expect(text).toContain('Nothing ran yesterday.');
    expect(text).not.toContain('Needs a look');
  });
  it('yesterday and the seven days before it, in the account’s time zone', () => {
    const r = digestRanges(new Date('2026-09-27T04:30:00Z'), 'Asia/Karachi');
    expect(r.yesterday).toEqual({ since: '2026-09-26', until: '2026-09-26' });
    expect(r.weekBefore).toEqual({ since: '2026-09-19', until: '2026-09-25' });
    expect(r.label).toBe('Sat 26 Sept');
  });
});

describe('adsDigestDoc', () => {
  it('is the same digest as a document: figures, the comparison table, what needs a look, the link', async () => {
    const { adsDigestDoc } = await import('./digest');
    const d = adsDigestDoc({
      shop: 'TAHERI', account, yesterday: m(2400, 6), weekBefore: m(14000, 28), month: pacing(27000, 50000, new Date('2026-09-27T12:00:00')),
      topAd: { name: 'Emerald jhumkas', metrics: m(1500, 4), goal: 'CONVERSATIONS' },
      attention: [{ kind: 'wasting', severity: 'bad', target: null, title: 'Rs 2,400 spent, no chats started: Lookalike', why: 'No chats in 7 days' }],
      erpUrl: 'https://erp.taheri.shop', date: 'Sat 26 Sep',
    }, new Date('2026-09-27T04:30:00Z'));
    expect(d.headline).toBe('Sat 26 Sep · spent Rs 2,400 · 6 chats');
    expect(d.figures?.map(f => [f.label, f.value, f.note])).toEqual([['Spent', 'Rs 2,400', '+20% vs the week'], ['Chats started', '6', 'Rs 400 each']]);
    const look = d.sections.find(s => s.title === 'Needs a look')!;
    expect(look.table?.rows).toEqual([['Rs 2,400 spent, no chats started: Lookalike']]);
    expect(look.table?.tones).toEqual(['flag']);
    expect(d.footnote).toBe('Open Ads in the ERP: https://erp.taheri.shop/ads');
  });
});
