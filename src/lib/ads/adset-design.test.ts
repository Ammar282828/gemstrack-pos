import { describe, expect, it } from 'vitest';
import { adCount, designAdsetParams, designCampaignParams, designProblems, goalsForObjective, nextAdSet, type AdSetDesign } from './adset-design';
import type { PlanContext } from './plan';

const NOW = Date.parse('2026-09-29T10:00:00Z');
const ctx: PlanContext = { pageId: 'P1', instagramUserId: 'IG1', instagramUsername: 'houseofmina__', whatsappGreeting: null, currency: 'PKR', minDaily: 150, now: NOW };

const first = { ...nextAdSet(null, 1, 'whatsapp'), name: 'Karachi women 25–44' };
const second = { ...nextAdSet(first, 2), name: 'Lookalike 1%' };
const design = (over: Partial<AdSetDesign> = {}): AdSetDesign => ({
  campaign: { kind: 'new', name: 'Ruby rings — audience test' },
  adsets: [first, second],
  ads: { kind: 'copy', ids: ['A1', 'A2'] },
  launch: 'paused',
  ...over,
});

describe('designing ad sets', () => {
  it('a new card starts as the one before it, so a test changes one thing', () => {
    expect(second.goal).toBe('whatsapp');
    expect(second.budget).toEqual(first.budget);
    expect(second.audience).toEqual(first.audience);
    expect(second.audience).not.toBe(first.audience);
    expect(second.key).not.toBe(first.key);
  });
  it('is ready when every ad set has a name, a place and a budget', () => {
    expect(designProblems(design(), ctx)).toEqual([]);
    expect(adCount(design())).toBe(4);
  });
  it('a new campaign has one kind of goal', () => {
    const d = design({ adsets: [first, { ...second, goal: 'website' }] });
    expect(designProblems(d, ctx)).toContain('One campaign has one kind of goal — give every ad set a goal of the same kind, or make them in two campaigns.');
    expect(designCampaignParams(design() as AdSetDesign & { campaign: { kind: 'new' } })).toMatchObject({ name: 'Ruby rings — audience test', objective: 'OUTCOME_ENGAGEMENT', status: 'PAUSED' });
  });
  it('in an existing campaign the goal follows its objective', () => {
    expect(goalsForObjective('OUTCOME_TRAFFIC').map(g => g.key)).toEqual(['website', 'channel', 'profile']);
    const d = design({ campaign: { kind: 'existing', id: 'C9', objective: 'OUTCOME_TRAFFIC', budgeted: false } });
    expect(designProblems(d, ctx)[0]).toBe('In this campaign an ad set’s goal is one of: Website visits, WhatsApp channel follows, Instagram profile visits.');
    expect(designProblems(design({ campaign: { kind: 'existing', id: 'C9', objective: 'OUTCOME_LEADS', budgeted: false } }), ctx)).toContain('The ERP can’t add ad sets to a campaign of this kind — open it in Ads Manager.');
  });
  it('a campaign that holds the budget gives its ad sets none', () => {
    const d = design({ campaign: { kind: 'existing', id: 'C9', objective: 'OUTCOME_ENGAGEMENT', budgeted: true }, adsets: [{ ...first, budget: { kind: 'daily', amount: 0, start: null, end: null } }] });
    expect(designProblems(d, ctx)).toEqual([]);
    const p = designAdsetParams(d.adsets[0], d, 'C9', ctx);
    expect(p).not.toHaveProperty('daily_budget');
    expect(p).toMatchObject({ campaign_id: 'C9', optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP', promoted_object: { page_id: 'P1' }, status: 'PAUSED', name: 'Karachi women 25–44' });
  });
  it('an ad set of its own carries its budget', () => {
    expect(designAdsetParams(first, design(), 'C1', ctx)).toMatchObject({ daily_budget: 100000 }); // Meta counts in paisa
  });
  it('names which ad set is wrong', () => {
    const d = design({ adsets: [first, { ...second, audience: { ...second.audience, places: [] }, budget: { kind: 'daily', amount: 100, start: null, end: null } }] });
    expect(designProblems(d, ctx)).toEqual(['Lookalike 1%: choose where it shows.', 'Lookalike 1%: Meta’s smallest daily budget here is Rs 150.']);
  });
  it('a boosted post can’t go to both apps, and a website goal needs its link', () => {
    const d = design({ ads: { kind: 'post', mediaId: 'M1' }, adsets: [{ ...first, goal: 'messages' }] });
    expect(designProblems(d, ctx)).toContain('“WhatsApp or Instagram chats” works with new photos, not a boosted post.');
    const w = design({ ads: { kind: 'post', mediaId: 'M1' }, adsets: [{ ...first, goal: 'website' }] });
    expect(designProblems(w, ctx)).toContain('give the website address the button opens.');
  });
  it('asks for the ads', () => {
    expect(designProblems(design({ ads: { kind: 'copy', ids: [] } }), ctx)).toContain('Choose the ads to put in them.');
  });
});
