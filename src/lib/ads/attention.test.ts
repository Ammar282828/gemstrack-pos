import { describe, expect, it } from 'vitest';
import { attentionItems, pacing } from './attention';
import { metricsOf, type AdsAccount, type TreeAd, type TreeAdSet, type TreeCampaign } from './shape';

const NOW = Date.parse('2026-09-27T09:00:00Z');
const account: AdsAccount = { id: '1', name: 'Taheri Collections', currency: 'PKR', timezone: 'Asia/Karachi', status: 1, disableReason: 0, amountSpent: 100000, spendCap: null, balance: 0, minDailyBudget: 150, funding: null, businessName: null };

const m = (spend: number, chats: number, reach = 5000, frequency = 1.5) => metricsOf({ spend: String(spend), impressions: String(reach * frequency), reach: String(reach), frequency: String(frequency), clicks: '10', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(chats) }] });
const ad = (id: string, over: Partial<TreeAd> = {}): TreeAd => ({ id, name: `Ad ${id}`, status: 'ACTIVE', effectiveStatus: 'ACTIVE', thumbnail: null, image: null, title: null, body: null, button: null, issues: [], metrics: m(100, 1), creativeId: null, instagramPermalink: null, ...over });
const set = (id: string, over: Partial<TreeAdSet> = {}): TreeAdSet => ({ id, name: `Set ${id}`, status: 'ACTIVE', effectiveStatus: 'ACTIVE', optimizationGoal: 'CONVERSATIONS', destination: 'WHATSAPP', dailyBudget: 1000, lifetimeBudget: null, startTime: null, endTime: null, learning: null, issues: [], metrics: m(3000, 5), ads: [ad(`${id}a`)], ...over });
const camp = (id: string, adsets: TreeAdSet[], over: Partial<TreeCampaign> = {}): TreeCampaign => ({ id, name: `Campaign ${id}`, status: 'ACTIVE', effectiveStatus: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT', dailyBudget: null, lifetimeBudget: null, startTime: null, stopTime: null, issues: [], metrics: m(3000, 5), adsets, ...over });

const kinds = (items: ReturnType<typeof attentionItems>) => items.map(i => i.kind);

describe('attentionItems', () => {
  it('a healthy account with a healthy campaign has nothing to say', () => {
    expect(attentionItems({ account, campaigns: [camp('c', [set('s')])], days: 7, now: NOW })).toEqual([]);
  });
  it('the account first: payment due, spending limit', () => {
    const items = attentionItems({ account: { ...account, status: 3, spendCap: 100000 }, campaigns: [camp('c', [set('s')])], days: 7, now: NOW });
    expect(kinds(items)).toEqual(['account', 'spend-cap']);
    expect(items[0].severity).toBe('bad');
    expect(items[1].title).toMatch(/Spending limit reached/);
  });
  it('nothing running', () => {
    const items = attentionItems({ account, campaigns: [camp('c', [set('s', { effectiveStatus: 'PAUSED', status: 'PAUSED' })], { effectiveStatus: 'PAUSED', status: 'PAUSED' })], days: 7, now: NOW });
    expect(kinds(items)).toContain('nothing-running');
  });
  it('a rejected ad is bad and opens that ad; a flagged running ad set is a warning', () => {
    const items = attentionItems({ account, campaigns: [camp('c', [set('s', { issues: ['Learning phase ended early'], ads: [ad('x', { effectiveStatus: 'DISAPPROVED', issues: ['Personal attributes'] })] })])], days: 7, now: NOW });
    expect(kinds(items)).toEqual(['rejected', 'issue']);
    expect(items[0].action).toEqual({ do: 'open', href: '/ads/campaigns?ad=x' });
    expect(items[0].why).toBe('Personal attributes');
  });
  it('spent two days’ budget with no chats → pause it', () => {
    const items = attentionItems({ account, campaigns: [camp('c', [set('s', { metrics: m(2400, 0) })])], days: 7, now: NOW });
    expect(items[0]).toMatchObject({ kind: 'wasting', severity: 'bad', action: { do: 'pause', level: 'adset', id: 's' } });
    expect(items[0].title).toContain('Rs 2,400 spent, no chats started');
  });
  it('a little spend with no chats is not yet a verdict', () => {
    expect(attentionItems({ account, campaigns: [camp('c', [set('s', { metrics: m(900, 0) })])], days: 7, now: NOW })).toEqual([]);
  });
  it('fatigue: frequency at 3 or more on a real audience', () => {
    const items = attentionItems({ account, campaigns: [camp('c', [set('s', { metrics: m(3000, 5, 4000, 3.4) })])], days: 7, now: NOW });
    expect(items[0]).toMatchObject({ kind: 'fatigue', severity: 'warn' });
    expect(items[0].title).toContain('3.4×');
  });
  it('an expensive ad set against three or more running ones', () => {
    const sets = [set('a', { metrics: m(1000, 10) }), set('b', { metrics: m(1000, 10) }), set('c', { metrics: m(1000, 10) }), set('d', { metrics: m(2000, 2) })];
    const items = attentionItems({ account, campaigns: [camp('c', sets)], days: 7, now: NOW });
    expect(items.map(i => [i.kind, i.target?.id])).toEqual([['expensive', 'd']]);
    expect(items[0].title).toContain('Rs 1,000 each');
  });
  it('ending soon, with what it brought', () => {
    const items = attentionItems({ account, campaigns: [camp('c', [set('s', { endTime: '2026-09-29T00:00:00Z' })])], days: 7, now: NOW });
    expect(items[0]).toMatchObject({ kind: 'ending-soon', severity: 'tip' });
    expect(items[0].title).toMatch(/Ends in 2 days/);
    expect(items[0].why).toContain('5 chats started at Rs 600 each');
  });
  it('a paused ad set that was cheaper than what runs now → resume it', () => {
    const items = attentionItems({ account, campaigns: [camp('c', [set('run', { metrics: m(5000, 5) }), set('old', { effectiveStatus: 'PAUSED', status: 'PAUSED', metrics: m(2000, 8) })])], days: 7, now: NOW });
    expect(items[0]).toMatchObject({ kind: 'paused-winner', action: { do: 'resume', level: 'adset', id: 'old' } });
  });
  it('orders by severity: bad, then warn, then tips', () => {
    const items = attentionItems({ account, campaigns: [camp('c', [set('s', { endTime: '2026-09-28T00:00:00Z', learning: 'Learning limited', metrics: m(3000, 5, 4000, 3.5) }), set('w', { metrics: m(2400, 0) })])], days: 7, now: NOW });
    expect(items.map(i => i.severity)).toEqual(['bad', 'warn', 'tip', 'tip']);
  });
});

describe('pacing', () => {
  it('projects the month from the pace so far', () => {
    const p = pacing(27000, 50000, new Date('2026-09-09T12:00:00'));
    expect(p).toEqual({ spent: 27000, projected: 90000, lastMonth: 50000, dayOfMonth: 9, daysInMonth: 30 });
  });
});
