import { describe, expect, it } from 'vitest';
import { checkDesign, checkPlan, designSummary, isDesignShape, isPlanShape, newAdLists, phoneGoals, quietDays, quietForBudget, spendWords, BUTTONS } from './phone-plan';
import { planSummary, type AdPlan, type PlanContext } from './plan';
import { nextAdSet, type AdSetDesign } from './adset-design';
import { defaultDraft, describeAudience, IG_POSITIONS } from './targeting';
import { adDayStatus, karachiDay } from './studio/calendar';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const ctx: PlanContext = { pageId: 'P1', instagramUserId: 'IG1', instagramUsername: 'example_shop', whatsappGreeting: null, currency: 'PKR', minDaily: 150, now: NOW };
const links = { website: 'https://example.com', shop: '', waChannel: '' };

const plan = (over: Partial<AdPlan> = {}): AdPlan => ({
  goal: 'whatsapp',
  source: { kind: 'photos', photos: [{ hash: 'H1' }] },
  text: 'Ruby ring — 4.2g',
  headline: 'Ruby ring',
  link: 'https://example.com/rings/ruby',
  button: 'SHOP_NOW',
  audience: defaultDraft(),
  budget: { kind: 'daily', amount: 1000, start: '2026-09-26T10:00:00Z', end: '2026-10-03T10:00:00Z' },
  launch: 'paused',
  name: '',
  ...over,
});

describe('the goals the phone offers', () => {
  it('gives every goal in the web’s words, with what New ad offers in this house', () => {
    const goals = phoneGoals(links);
    expect(goals.map(g => g.key)).toEqual(['whatsapp', 'messages', 'instagram_dm', 'website', 'sales', 'channel', 'profile', 'engagement', 'reach']);
    expect(goals.find(g => g.key === 'whatsapp')).toMatchObject({ label: 'WhatsApp chats', objective: 'OUTCOME_ENGAGEMENT', optimization: 'CONVERSATIONS', postOnly: false, photosOnly: false, toSite: false, newAd: true });
    expect(goals.find(g => g.key === 'engagement')?.postOnly).toBe(true);
    expect(goals.find(g => g.key === 'messages')?.photosOnly).toBe(true);
    expect(goals.find(g => g.key === 'website')?.toSite).toBe(true);
  });
  it('offers channel follows only with a channel, and orders only with a site', () => {
    expect(phoneGoals(links).find(g => g.key === 'channel')?.newAd).toBe(false);
    expect(phoneGoals({ ...links, waChannel: 'https://whatsapp.com/channel/X' }).find(g => g.key === 'channel')?.newAd).toBe(true);
    expect(phoneGoals({ website: '', shop: '', waChannel: '' }).find(g => g.key === 'sales')?.newAd).toBe(false);
    expect(phoneGoals({ website: '', shop: 'https://shop.example.com', waChannel: '' }).find(g => g.key === 'sales')?.newAd).toBe(true);
  });
});

describe('newAdLists', () => {
  it('carries the buttons, the placements and the links; website pieces only with a website', () => {
    const l = newAdLists(links, { sitePieces: true, calendar: false, now: NOW });
    expect(l.buttons).toBe(BUTTONS);
    expect(l.igPositions).toBe(IG_POSITIONS);
    expect(l.links).toEqual(links);
    expect(l.sitePieces).toBe(true);
    expect(l.quiet).toEqual([]);
    expect(newAdLists({ ...links, website: '' }, { sitePieces: true, calendar: false, now: NOW }).sitePieces).toBe(false);
    expect(newAdLists(links, { sitePieces: false, calendar: false, now: NOW }).sitePieces).toBe(false);
  });
  it('lists the year’s quiet days when the house keeps the calendar', () => {
    const l = newAdLists(links, { sitePieces: true, calendar: true, now: NOW });
    expect(l.quiet.length).toBeGreaterThan(5);
    for (const d of l.quiet) {
      const s = adDayStatus(d.date);
      expect(['sacred', 'near']).toContain(s.level);
      expect(d.near).toBe(s.level === 'near');
      expect(d.name).toBe(s.observance?.name);
      expect(d.hijri).toMatch(/\d+ \S.* \d{4}/);
    }
    expect(l.quiet[0].date >= karachiDay(new Date(NOW))).toBe(true);
  });
});

describe('quiet days', () => {
  it('leaves out the lunar firsts (a cultural post, not a warning) and keeps sacred days and the days before', () => {
    const all = quietDays('2026-01-01', '2026-12-31');
    expect(all.every(d => adDayStatus(d.date).level !== 'quiet')).toBe(true);
    expect(all.some(d => d.near)).toBe(true);
    expect(all.some(d => !d.near)).toBe(true);
  });
  it('runs from the start to the end, or a month on when it is left running', () => {
    const year = quietDays('2026-01-01', '2027-12-31');
    const day = year.find(d => !d.near)!;
    const at = Date.parse(`${day.date}T12:00:00+05:00`);
    const around = { kind: 'daily' as const, amount: 500, start: new Date(at - 86_400_000).toISOString(), end: new Date(at + 86_400_000).toISOString() };
    expect(quietForBudget(around).map(d => d.date)).toContain(day.date);
    const before = { ...around, start: new Date(at - 40 * 86_400_000).toISOString(), end: new Date(at - 35 * 86_400_000).toISOString() };
    expect(quietForBudget(before).map(d => d.date)).not.toContain(day.date);
    const running = { kind: 'daily' as const, amount: 500, start: null, end: null };
    expect(quietForBudget(running, at - 10 * 86_400_000).map(d => d.date)).toContain(day.date);
  });
});

describe('shapes', () => {
  it('a plan without a name can be checked; anything else is refused', () => {
    expect(isPlanShape(plan())).toBe(true);
    expect(isPlanShape({ ...plan(), goal: 'likes' })).toBe(false);
    expect(isPlanShape({ ...plan(), launch: 'now' })).toBe(false);
    expect(isPlanShape({ ...plan(), audience: {} })).toBe(false);
    expect(isPlanShape(null)).toBe(false);
  });
  it('a design needs ad sets with a goal, an audience and a budget', () => {
    const d: AdSetDesign = { campaign: { kind: 'new', name: 'Test' }, adsets: [nextAdSet(null, 1)], ads: { kind: 'copy', ids: ['A1'] }, launch: 'paused' };
    expect(isDesignShape(d)).toBe(true);
    expect(isDesignShape({ ...d, adsets: [] })).toBe(false);
    expect(isDesignShape({ ...d, adsets: [{ ...d.adsets[0], goal: 'likes' }] })).toBe(false);
    expect(isDesignShape({ ...d, ads: undefined })).toBe(false);
  });
});

describe('checkPlan', () => {
  it('names the ad as New ad would and gives planSummary’s own lines', () => {
    const c = checkPlan(plan(), ctx);
    expect(c.problems).toEqual([]);
    expect(c.name).toBe('WhatsApp chats · Ruby ring · 2026-09-25');
    expect(c.summary).toEqual(planSummary({ ...plan(), name: c.name }, 'PKR'));
    expect(c.summary).toContain('Budget: Rs 1,000 a day for 7 days — at most about Rs 7,000');
    expect(c.summary.at(-1)).toBe('Saved paused — nothing is spent until it is switched on');
    expect(c.audience).toBe(describeAudience(defaultDraft()));
  });
  it('keeps a typed name, and says what stops it', () => {
    expect(checkPlan(plan({ name: '  Diwali rings ' }), ctx).name).toBe('Diwali rings');
    const c = checkPlan(plan({ text: '', budget: { kind: 'daily', amount: 100, start: null, end: null } }), ctx);
    expect(c.problems).toContain('Write what the ad says.');
    expect(c.problems).toContain('Meta’s smallest daily budget for this account is Rs 150.');
    expect(checkPlan(plan(), { ...ctx, pageId: null }).problems[0]).toMatch(/Facebook Page/);
  });
  it('says live when it goes live', () => {
    expect(checkPlan(plan({ launch: 'live' }), ctx).summary.at(-1)).toMatch(/^Starts as soon as Meta approves it/);
  });
});

describe('spendWords', () => {
  it('says a budget exactly as planSummary does', () => {
    const budgets: AdPlan['budget'][] = [
      { kind: 'daily', amount: 1000, start: '2026-09-26T10:00:00Z', end: '2026-10-03T10:00:00Z' },
      { kind: 'daily', amount: 1500, start: '2026-09-26T10:00:00Z', end: null },
      { kind: 'total', amount: 20000, start: '2026-09-26T10:00:00Z', end: '2026-10-10T10:00:00Z' },
      { kind: 'daily', amount: 500, start: '2026-09-26T10:00:00Z', end: '2026-09-27T09:00:00Z' },
    ];
    for (const b of budgets) expect(`Budget: ${spendWords(b, 'PKR')}`).toBe(planSummary(plan({ budget: b }), 'PKR')[3]);
  });
});

describe('designSummary and checkDesign', () => {
  const first = { ...nextAdSet(null, 1, 'whatsapp'), name: 'Women 25–44', budget: { kind: 'daily' as const, amount: 1000, start: '2026-09-26T10:00:00Z', end: '2026-10-03T10:00:00Z' } };
  const second = { ...nextAdSet(first, 2), name: 'Lookalike 1%', budget: { kind: 'daily' as const, amount: 500, start: '2026-09-26T10:00:00Z', end: '2026-10-03T10:00:00Z' } };
  const design = (over: Partial<AdSetDesign> = {}): AdSetDesign => ({
    campaign: { kind: 'new', name: 'Ruby rings — test' }, adsets: [first, second], ads: { kind: 'copy', ids: ['A1', 'A2'] }, launch: 'paused', ...over,
  });

  it('says where, each ad set’s goal, budget and audience, the ads, and what they cost together', () => {
    expect(designSummary(design(), 'PKR', NOW)).toEqual([
      'A new campaign: “Ruby rings — test”',
      `Women 25–44: WhatsApp chats · Rs 1,000 a day for 7 days — at most about Rs 7,000 · ${describeAudience(first.audience)}`,
      `Lookalike 1%: WhatsApp chats · Rs 500 a day for 7 days — at most about Rs 3,500 · ${describeAudience(second.audience)}`,
      'Together: Rs 1,500 a day, at most about Rs 10,500 in all',
      '4 ads: a copy of each of the 2 chosen ads in every ad set',
      'Made paused — nothing is spent until they are switched on',
    ]);
  });
  it('a campaign that holds the budget is named, and its ad sets share it', () => {
    const lines = designSummary(design({ campaign: { kind: 'existing', id: 'C1', objective: 'OUTCOME_ENGAGEMENT', budgeted: true, name: 'Autumn' } }), 'PKR', NOW);
    expect(lines[0]).toBe('Into the campaign “Autumn” (Engagement)');
    expect(lines[1]).toContain('shares the campaign’s own budget');
    expect(lines.some(l => l.startsWith('Together'))).toBe(false);
  });
  it('one left running has no ceiling; a boosted post; live', () => {
    const open = { ...second, budget: { kind: 'daily' as const, amount: 500, start: null, end: null } };
    const lines = designSummary(design({ adsets: [first, open], ads: { kind: 'post', mediaId: 'M1' }, launch: 'live' }), 'PKR', NOW);
    expect(lines).toContain('Together: Rs 1,500 a day, until they are paused');
    expect(lines).toContain('2 ads: the Instagram post, as it is, in every ad set');
    expect(lines.at(-1)).toMatch(/^They start as soon as Meta approves them/);
  });
  it('checkDesign gives designProblems, the summary and the count', () => {
    const c = checkDesign(design(), ctx);
    expect(c.problems).toEqual([]);
    expect(c.count).toBe(4);
    expect(c.summary[0]).toBe('A new campaign: “Ruby rings — test”');
    expect(checkDesign(design({ campaign: { kind: 'new', name: ' ' } }), ctx).problems).toContain('Name the campaign.');
  });
});
