import { describe, expect, it } from 'vitest';
import { compact, currencyOffset, fromMinor, headlineActions, metricsOf, money, resultOf, sumMetrics, toMinor } from './shape';
import { fieldsRejected, previousPeriod } from './insights';
import { metaError } from './meta';
import { describeRule, ruleSpecs } from './rules';

describe('money', () => {
  it('budgets are in the currency’s smallest unit — paisa for rupees, whole yen', () => {
    expect(currencyOffset('PKR')).toBe(100);
    expect(toMinor(1500, 'PKR')).toBe(150000);
    expect(fromMinor('150000', 'PKR')).toBe(1500);
    expect(currencyOffset('JPY')).toBe(1);
    expect(toMinor(1500, 'JPY')).toBe(1500);
    expect(fromMinor(null, 'PKR')).toBe(0);
  });
  it('reads as the counter says it', () => {
    expect(money(1500, 'PKR')).toBe('Rs 1,500');
    expect(money(12.5, 'PKR')).toBe('Rs 12.50');
    expect(money(1234.5, 'USD', { cents: true })).toBe('$ 1,234.50');
    expect(compact(12_345)).toBe('12.3k');
    expect(compact(1_250_000)).toBe('1.25M');
  });
});

describe('metrics', () => {
  const row = { spend: '1200.50', impressions: '10000', reach: '6000', clicks: '150', inline_link_clicks: '90', ctr: '1.5', cpm: '120.05', actions: [
    { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '24' },
    { action_type: 'link_click', value: '90' },
    { action_type: 'post_engagement', value: '300' },
  ] };
  it('turns Meta’s strings into numbers', () => {
    const m = metricsOf(row);
    expect([m.spend, m.impressions, m.reach, m.linkClicks]).toEqual([1200.5, 10000, 6000, 90]);
    expect(m.actions['link_click']).toBe(90);
  });
  it('a result is what the ad set optimises for', () => {
    const m = metricsOf(row);
    expect(resultOf(m, 'CONVERSATIONS')).toEqual({ label: 'Chats started', value: 24 });
    expect(resultOf(m, 'REACH')).toEqual({ label: 'People reached', value: 6000 });
    expect(resultOf(m, 'LINK_CLICKS')).toEqual({ label: 'Link clicks', value: 90 });
    expect(resultOf(m, 'SOMETHING_NEW')).toBeNull();
  });
  it('no chats is a real 0; an undocumented result (profile visits) is left blank instead', () => {
    expect(resultOf(metricsOf({ spend: '10' }), 'CONVERSATIONS')).toEqual({ label: 'Chats started', value: 0 });
    expect(resultOf(metricsOf({ spend: '10' }), 'VISIT_INSTAGRAM_PROFILE')).toBeNull();
  });
  it('adds rows up and recomputes the rates', () => {
    const s = sumMetrics([metricsOf({ spend: '100', impressions: '1000', clicks: '10' }), metricsOf({ spend: '100', impressions: '3000', clicks: '30' })]);
    expect([s.spend, s.impressions, s.clicks, s.ctr, s.cpm, s.cpc]).toEqual([200, 4000, 40, 1, 50, 5]);
  });
  it('headline actions, biggest idea first, each once', () => {
    expect(headlineActions(metricsOf(row)).map(a => a.label)).toEqual(['Chats started', 'Link clicks', 'Post engagement']);
  });
});

describe('insights helpers', () => {
  it('finds the fields Meta refused', () => {
    expect(fieldsRejected('(#100) reach, frequency are not valid fields for this request', ['spend', 'reach', 'frequency', 'cpm'])).toEqual(['reach', 'frequency']);
    expect(fieldsRejected('(#17) User request limit reached', ['spend', 'reach'])).toEqual([]);
  });
  it('the same length of time just before', () => {
    expect(previousPeriod('2026-09-19', '2026-09-25')).toEqual({ since: '2026-09-12', until: '2026-09-18' });
    expect(previousPeriod('2026-09-25', '2026-09-25')).toEqual({ since: '2026-09-24', until: '2026-09-24' });
    expect(previousPeriod('x', 'y')).toBeNull();
  });
});

describe('metaError', () => {
  it('prefers the words Meta wrote for people, and maps the code to a status', () => {
    const e = metaError({ error: { message: '(#100) Invalid parameter', code: 100, error_subcode: 1885183, error_user_title: 'Ads creative post was created by an app', error_user_msg: 'Pick another post.', fbtrace_id: 'T' } }, 400);
    expect([e.message, e.status, e.code, e.subcode, e.fbtrace]).toEqual(['Ads creative post was created by an app: Pick another post.', 400, 100, 1885183, 'T']);
  });
  it('expired login → 401, rate limit → 429, permissions → 403', () => {
    expect(metaError({ error: { message: 'Session has expired', code: 190 } }, 400).status).toBe(401);
    expect(metaError({ error: { message: 'User request limit reached', code: 17 } }, 400).status).toBe(429);
    expect(metaError({ error: { message: 'Requires ads_management', code: 200 } }, 403).status).toBe(403);
    expect(metaError({}, 500).message).toBe('Meta answered 500');
  });
});

describe('rules', () => {
  it('pause-when-nothing-comes: ad sets, today, spent over the amount in paisa, no results, every half hour', () => {
    const r = ruleSpecs('pause_no_results', 500, 'PKR', 'U1');
    expect(r.evaluation_spec).toEqual({ evaluation_type: 'SCHEDULE', filters: [
      { field: 'entity_type', value: 'ADSET', operator: 'EQUAL' },
      { field: 'time_preset', value: 'TODAY', operator: 'EQUAL' },
      { field: 'spent', value: 50000, operator: 'GREATER_THAN' },
      { field: 'results', value: 1, operator: 'LESS_THAN' },
    ] });
    expect(r.execution_spec).toEqual({ execution_type: 'PAUSE', execution_options: [{ field: 'user_ids', value: ['U1'], operator: 'EQUAL' }] });
    expect(r.schedule_spec).toEqual({ schedule_type: 'SEMI_HOURLY' });
    expect(r.name).toBe('Pause what’s not working — Rs 500');
  });
  it('reads a rule back in words', () => {
    const r = ruleSpecs('notify_no_results', 500, 'PKR', null);
    expect(describeRule(r as Parameters<typeof describeRule>[0], 'PKR')).toBe('ad sets · today · spent > Rs 500 · results < 1 → notify, every 30 min');
  });
});
