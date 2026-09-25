import { describe, expect, it } from 'vitest';
import { adsetParams, callToAction, campaignParams, creativeSpec, defaultName, enhancementsRejected, NO_ENHANCEMENTS, planProblems, planSummary, WHATSAPP_LINK, type AdPlan, type PlanContext } from './plan';
import { defaultDraft } from './targeting';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const ctx: PlanContext = { pageId: 'P1', instagramUserId: 'IG1', instagramUsername: 'collectionstaheri', whatsappGreeting: 'Hi! Tell me more', currency: 'PKR', minDaily: 150, now: NOW };

const plan = (over: Partial<AdPlan> = {}): AdPlan => ({
  goal: 'whatsapp',
  source: { kind: 'photos', photos: [{ hash: 'H1' }] },
  text: 'Emerald jhumkas — 12.4g',
  headline: 'Emerald jhumkas',
  link: 'https://taheri.shop/earrings/emerald',
  button: 'SHOP_NOW',
  audience: defaultDraft(),
  budget: { kind: 'daily', amount: 1000, start: null, end: '2026-10-02T10:00:00Z' },
  launch: 'paused',
  name: 'WhatsApp chats · Emerald jhumkas · 2026-09-25',
  ...over,
});

describe('campaignParams', () => {
  it('always says the ad sets keep their own budgets (required since v24) and starts paused', () => {
    expect(campaignParams(plan())).toEqual({
      name: 'WhatsApp chats · Emerald jhumkas · 2026-09-25', objective: 'OUTCOME_ENGAGEMENT', status: 'PAUSED',
      special_ad_categories: [], is_adset_budget_sharing_enabled: false,
    });
  });
  it('uses each goal’s objective', () => {
    expect(campaignParams(plan({ goal: 'website' })).objective).toBe('OUTCOME_TRAFFIC');
    expect(campaignParams(plan({ goal: 'reach' })).objective).toBe('OUTCOME_AWARENESS');
  });
});

describe('adsetParams', () => {
  it('WhatsApp chats: conversations, WhatsApp destination, the Page promoted, budget in paisa', () => {
    const p = adsetParams(plan(), 'C1', ctx);
    expect(p).toMatchObject({
      campaign_id: 'C1', status: 'PAUSED', billing_event: 'IMPRESSIONS', optimization_goal: 'CONVERSATIONS',
      destination_type: 'WHATSAPP', promoted_object: { page_id: 'P1' }, daily_budget: 100000, bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      end_time: '2026-10-02T10:00:00.000Z',
    });
    expect(p).not.toHaveProperty('lifetime_budget');
    expect((p.targeting as Record<string, unknown>).targeting_automation).toEqual({ advantage_audience: 1 });
  });
  it('a total budget goes in as lifetime_budget', () => {
    const p = adsetParams(plan({ budget: { kind: 'total', amount: 7000, start: null, end: '2026-10-02T10:00:00Z' } }), 'C1', ctx);
    expect(p.lifetime_budget).toBe(700000);
    expect(p).not.toHaveProperty('daily_budget');
  });
  it('reach has no destination and promotes nothing', () => {
    const p = adsetParams(plan({ goal: 'reach' }), 'C1', ctx);
    expect(p.optimization_goal).toBe('REACH');
    expect(p).not.toHaveProperty('destination_type');
    expect(p).not.toHaveProperty('promoted_object');
  });
  it('Instagram messages go to Instagram Direct', () => {
    expect(adsetParams(plan({ goal: 'instagram_dm' }), 'C1', ctx)).toMatchObject({ destination_type: 'INSTAGRAM_DIRECT', optimization_goal: 'CONVERSATIONS', promoted_object: { page_id: 'P1' } });
  });
});

describe('creativeSpec', () => {
  it('a WhatsApp photo ad opens WhatsApp with the greeting, and asks Meta to change nothing', () => {
    const c = creativeSpec(plan(), ctx);
    expect(c.object_story_spec).toEqual({
      page_id: 'P1', instagram_user_id: 'IG1',
      link_data: {
        message: 'Emerald jhumkas — 12.4g', image_hash: 'H1', name: 'Emerald jhumkas', link: WHATSAPP_LINK,
        call_to_action: { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } },
        page_welcome_message: 'Hi! Tell me more',
      },
    });
    expect(c.degrees_of_freedom_spec).toEqual({ creative_features_spec: NO_ENHANCEMENTS });
    expect(Object.values(NO_ENHANCEMENTS).every(v => v.enroll_status === 'OPT_OUT')).toBe(true);
    expect(Object.keys(NO_ENHANCEMENTS)).toEqual(expect.arrayContaining(['image_touchups', 'image_background_gen', 'adapt_to_placement', 'text_optimizations']));
  });
  it('an Instagram-message ad has no link, as in Meta’s own example', () => {
    const ld = (creativeSpec(plan({ goal: 'instagram_dm' }), ctx).object_story_spec as { link_data: Record<string, unknown> }).link_data;
    expect(ld).not.toHaveProperty('link');
    expect(ld.call_to_action).toEqual({ type: 'INSTAGRAM_MESSAGE', value: { app_destination: 'INSTAGRAM_DIRECT' } });
    expect(ld).not.toHaveProperty('page_welcome_message');
  });
  it('a website ad links the button to the page', () => {
    const ld = (creativeSpec(plan({ goal: 'website', button: 'LEARN_MORE' }), ctx).object_story_spec as { link_data: Record<string, unknown> }).link_data;
    expect(ld.link).toBe('https://taheri.shop/earrings/emerald');
    expect(ld.call_to_action).toEqual({ type: 'LEARN_MORE', value: { link: 'https://taheri.shop/earrings/emerald' } });
  });
  it('several photos make a carousel in the order chosen, each card with its own link', () => {
    const p = plan({ goal: 'website', source: { kind: 'photos', photos: [{ hash: 'A', headline: 'Ring', link: 'https://taheri.shop/a' }, { hash: 'B' }] } });
    const ld = (creativeSpec(p, ctx).object_story_spec as { link_data: Record<string, unknown> }).link_data;
    expect(ld.multi_share_optimized).toBe(false);
    expect(ld.child_attachments).toEqual([
      { image_hash: 'A', link: 'https://taheri.shop/a', name: 'Ring', call_to_action: { type: 'SHOP_NOW', value: { link: 'https://taheri.shop/a' } } },
      { image_hash: 'B', link: 'https://taheri.shop/earrings/emerald', name: 'Emerald jhumkas', call_to_action: { type: 'SHOP_NOW', value: { link: 'https://taheri.shop/earrings/emerald' } } },
    ]);
  });
  it('boosting a post names the Page, the Instagram account and the post — and adds no button for engagement', () => {
    const c = creativeSpec(plan({ goal: 'engagement', source: { kind: 'post', mediaId: 'M1' } }), ctx);
    expect(c).toMatchObject({ object_id: 'P1', instagram_user_id: 'IG1', source_instagram_media_id: 'M1' });
    expect(c).not.toHaveProperty('call_to_action');
    expect(c).not.toHaveProperty('object_story_spec');
  });
  it('a boosted post for chats gets the WhatsApp button', () => {
    const c = creativeSpec(plan({ source: { kind: 'post', mediaId: 'M1' } }), ctx);
    expect(c.call_to_action).toEqual({ type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } });
  });
  it('profile visits point at the shop’s own profile', () => {
    expect(callToAction(plan({ goal: 'profile' }), '', ctx)).toEqual({ type: 'VIEW_INSTAGRAM_PROFILE', value: { link: 'https://www.instagram.com/collectionstaheri/' } });
  });
  it('can leave out photo switches Meta doesn’t know', () => {
    const { image_touchups: _drop, ...rest } = NO_ENHANCEMENTS;
    expect(creativeSpec(plan(), ctx, { enhancements: rest }).degrees_of_freedom_spec).toEqual({ creative_features_spec: rest });
    expect(enhancementsRejected('(#100) Invalid parameter: image_touchups is not a valid creative feature')).toEqual(['image_touchups']);
    expect(enhancementsRejected('(#100) something else')).toEqual([]);
  });
});

describe('planProblems', () => {
  it('a sound plan has none', () => {
    expect(planProblems(plan(), ctx)).toEqual([]);
  });
  it('needs a Page and an Instagram account', () => {
    const out = planProblems(plan(), { ...ctx, pageId: null, instagramUserId: null });
    expect(out.join(' ')).toMatch(/Facebook Page/);
    expect(out.join(' ')).toMatch(/Instagram account/);
  });
  it('a total budget needs an end date at least a day away', () => {
    expect(planProblems(plan({ budget: { kind: 'total', amount: 5000, start: null, end: null } }), ctx)).toContain('A total budget needs an end date.');
    expect(planProblems(plan({ budget: { kind: 'total', amount: 5000, start: null, end: '2026-09-25T20:00:00Z' } }), ctx)).toContain('A total budget needs to run for at least a day.');
  });
  it('holds to the account’s smallest daily budget', () => {
    expect(planProblems(plan({ budget: { kind: 'daily', amount: 100, start: null, end: null } }), ctx)[0]).toMatch(/Rs 150/);
  });
  it('engagement is for existing posts only; photos need words', () => {
    expect(planProblems(plan({ goal: 'engagement' }), ctx).join(' ')).toMatch(/existing Instagram post/);
    expect(planProblems(plan({ text: ' ' }), ctx)).toContain('Write what the ad says.');
  });
  it('website visits need an address', () => {
    expect(planProblems(plan({ goal: 'website', link: '' }), ctx)).toContain('Give the website address the ad opens.');
    expect(planProblems(plan({ goal: 'website', link: '', source: { kind: 'photos', photos: [{ hash: 'A', link: 'https://taheri.shop/a' }] } }), ctx)).toEqual([]);
  });
  it('an end in the past is caught', () => {
    expect(planProblems(plan({ budget: { kind: 'daily', amount: 1000, start: null, end: '2026-09-01T00:00:00Z' } }), ctx)).toContain('The end date has passed.');
  });
});

describe('names and summaries', () => {
  it('names the ad by goal, headline and day', () => {
    expect(defaultName(plan(), NOW)).toBe('WhatsApp chats · Emerald jhumkas · 2026-09-25');
    expect(defaultName({ goal: 'engagement', headline: '', source: { kind: 'post', mediaId: 'M', caption: 'New in: ruby kara\nmore' } }, NOW)).toBe('Likes, comments and saves · New in: ruby kara · 2026-09-25');
  });
  it('says what it will cost at most', () => {
    const s = planSummary(plan({ budget: { kind: 'daily', amount: 1000, start: '2026-09-25T10:00:00Z', end: '2026-10-02T10:00:00Z' } }), 'PKR');
    expect(s.find(l => l.startsWith('Budget'))).toBe('Budget: Rs 1,000 a day for 7 days — at most about Rs 7,000');
  });
});
