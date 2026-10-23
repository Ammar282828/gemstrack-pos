import { describe, expect, it } from 'vitest';
import {
  classifySource, cleanPath, dayUpdate, fieldKey, liveSummary, parseDevice, parseVisit, period, series, summarize, unFieldKey,
  type Ctx, type DayDoc,
} from './site-analytics';

const base = { v: 'visitor_abc123', s: 'session_xyz789' };
const ctx: Ctx = { source: { channel: 'social', name: 'Instagram' }, place: { cc: 'PK', region: 'Sindh', city: 'Karachi' }, device: parseDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0'), hour: 21 };
const plain = (n: number) => n;

/** What a run of batches does to one day's counters, the way Firestore's increments would add up. */
function apply(day: Record<string, unknown>, upd: Record<string, unknown>) {
  for (const [k, v] of Object.entries(upd)) {
    if (typeof v === 'number') day[k] = ((day[k] as number) || 0) + v;
    else { day[k] ??= {}; apply(day[k] as Record<string, unknown>, v as Record<string, unknown>); }
  }
  return day;
}

describe('parseVisit', () => {
  it('reads a full batch', () => {
    const v = parseVisit({ ...base, c: { r: 'L.Instagram.com', u: { s: 'Instagram', m: 'paid', c: 'Eid Sale' }, k: 'fb', l: '/Rings-Bands?utm_source=x', n: 1 }, o: 1, d: 1, n: 0,
      p: [['/rings-bands', 'collection'], ['/rings-bands/band-147', 'piece']], q: ['  Gold   Ring ', 'x'], f: ['piece', 'piece', 'buy'], t: 12_000, at: '/rings-bands/band-147' })!;
    expect(v).toMatchObject({ ref: 'l.instagram.com', utm: { s: 'instagram', m: 'paid', c: 'Eid Sale' }, click: 'fb', landing: '/rings-bands', isNew: true, opens: true, firstToday: true, ms: 12_000 });
    expect(v.pages).toEqual([{ path: '/rings-bands', kind: 'collection' }, { path: '/rings-bands/band-147', kind: 'piece' }]);
    expect(v.searches).toEqual(['gold ring']);
    expect(v.steps).toEqual(['piece']);
  });
  it('refuses bad ids and an older page\'s piece-only batch', () => {
    expect(parseVisit({ e: [['view', 'a']] })).toBeNull();
    expect(parseVisit({ v: 'short', s: 'session_xyz789' })).toBeNull();
    expect(parseVisit({ v: 'has spaces in it', s: 'session_xyz789' })).toBeNull();
    expect(parseVisit(null)).toBeNull();
  });
  it('drops junk inside a good batch and caps time', () => {
    const v = parseVisit({ ...base, p: [['https://evil.com/x'], ['//x'], [5], ['/ok', 'nonsense']], t: 99_999_999, n: -4 })!;
    expect(v.pages).toEqual([{ path: '/ok', kind: 'other' }]);
    expect(v.ms).toBe(180_000);
    expect(v.before).toBe(0);
  });
  it('cleans paths', () => {
    expect(cleanPath('/Sets/Bridal%20Set/?a=1#x')).toBe('/sets/bridal set');
    expect(cleanPath('/')).toBe('/');
    expect(cleanPath('x')).toBe('');
  });
});

describe('classifySource', () => {
  const v = (ref = '', s = '', m = '', click: '' | 'fb' | 'g' | 'tt' | 'ig' = '') => ({ ref, utm: { s, m, c: '' }, click });
  it('direct, and the site itself is no referrer', () => {
    expect(classifySource(v())).toEqual({ channel: 'direct', name: 'Direct' });
    expect(classifySource(v('taheri.shop'), 'taheri.shop')).toEqual({ channel: 'direct', name: 'Direct' });
  });
  it('social by referrer, in-app and link shims', () => {
    expect(classifySource(v('l.instagram.com'))).toEqual({ channel: 'social', name: 'Instagram' });
    expect(classifySource(v('lm.facebook.com'))).toEqual({ channel: 'social', name: 'Facebook' });
    expect(classifySource(v('web.whatsapp.com'))).toEqual({ channel: 'social', name: 'WhatsApp' });
    expect(classifySource(v('', '', '', 'fb'))).toEqual({ channel: 'social', name: 'Facebook' });
  });
  it('search, referral, paid by utm or click id', () => {
    expect(classifySource(v('google.com.pk'))).toEqual({ channel: 'search', name: 'Google' });
    expect(classifySource(v('blog.example.com'))).toEqual({ channel: 'referral', name: 'blog.example.com' });
    expect(classifySource(v('', 'facebook', 'paid'))).toEqual({ channel: 'paid', name: 'Facebook' });
    expect(classifySource(v('instagram.com', 'ig', 'cpc'))).toEqual({ channel: 'paid', name: 'Instagram' });
    expect(classifySource(v('', 'instagram', '', 'fb'))).toEqual({ channel: 'paid', name: 'Instagram' });
    expect(classifySource(v('', '', '', 'g'))).toEqual({ channel: 'paid', name: 'Google' });
    expect(classifySource(v('', 'newsletter', 'email'))).toEqual({ channel: 'email', name: 'newsletter' });
  });
});

describe('parseDevice', () => {
  it('tells phones, tablets, in-app browsers and bots apart', () => {
    expect(ctx.device).toMatchObject({ device: 'mobile', os: 'iOS', browser: 'Instagram', bot: false });
    expect(parseDevice('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toMatchObject({ device: 'mobile', os: 'Android', browser: 'Chrome' });
    expect(parseDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toMatchObject({ device: 'tablet', os: 'iPadOS', browser: 'Safari' });
    expect(parseDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toMatchObject({ device: 'desktop', os: 'Windows', browser: 'Edge' });
    expect(parseDevice('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)').bot).toBe(true);
    expect(parseDevice('facebookexternalhit/1.1').bot).toBe(true);
    expect(parseDevice('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36').bot).toBe(true);
    expect(parseDevice('').bot).toBe(true);
  });
});

describe('dayUpdate and summarize', () => {
  it('a bounced session: one page, one bounce, one exit', () => {
    const day = apply({ day: '2026-10-23' }, dayUpdate(parseVisit({ ...base, o: 1, d: 1, c: { n: 1, l: '/' }, p: [['/', 'home']], t: 4000 })!, ctx, plain)) as unknown as DayDoc;
    const s = summarize([day]);
    expect(s).toMatchObject({ sessions: 1, visitors: 1, newVisitors: 1, newSessions: 1, pageviews: 1, bounces: 1, bounceRate: 1, avgSessionMs: 4000 });
    expect(s.exits).toEqual([{ key: '/', value: 1 }]);
    expect(s.landing).toEqual([{ key: '/', value: 1 }]);
    expect(s.countries).toEqual([{ key: 'PK', value: 1 }]);
    expect(s.cities).toEqual([{ cc: 'PK', region: 'Sindh', city: 'Karachi', sessions: 1 }]);
    expect(s.browsers).toEqual([{ key: 'Instagram', value: 1 }]);
    expect(day.hours).toEqual({ 21: 1 });
  });

  it('a session over three batches: the bounce is taken back, the exit follows the last page, the funnel and source count once', () => {
    const day: Record<string, unknown> = { day: '2026-10-23' };
    apply(day, dayUpdate(parseVisit({ ...base, o: 1, d: 1, c: { l: '/sets', u: { c: 'Eid' } }, p: [['/sets', 'collection']], t: 3000 })!, ctx, plain));
    apply(day, dayUpdate(parseVisit({ ...base, c: { u: { c: 'Eid' } }, n: 1, pp: '/sets', p: [['/sets/a', 'piece'], ['/sets/b', 'piece']], f: ['piece', 'save'], q: ['ruby'], t: 30_000 })!, ctx, plain));
    apply(day, dayUpdate(parseVisit({ ...base, c: { u: { c: 'Eid' } }, n: 3, pp: '/sets/b', p: [['/nope', '404']], f: ['enquire'], t: 9000 })!, ctx, plain));
    const s = summarize([day as unknown as DayDoc]);
    expect(s).toMatchObject({ sessions: 1, pageviews: 4, bounces: 0, bounceRate: 0, durMs: 42_000, returningSessions: 1, conversion: 1 });
    expect(s.funnel).toEqual({ sessions: 1, piece: 1, save: 1, enquire: 1 });
    expect(s.exits).toEqual([{ key: '/nope', value: 1 }]);
    expect(s.notFound).toEqual([{ key: '/nope', value: 1 }]);
    expect(s.collections).toEqual([{ key: '/sets', value: 1 }]);
    expect(s.searches).toEqual([{ key: 'ruby', value: 1 }]);
    expect(s.sources).toEqual([{ key: 'social:Instagram', channel: 'social', name: 'Instagram', sessions: 1, piece: 1, save: 1, enquire: 1 }]);
    expect(s.campaigns).toEqual([{ key: 'Eid', value: 1, piece: 1, save: 1, enquire: 1 }]);
    expect(s.channels).toEqual([{ key: 'social', value: 1 }]);
  });

  it('a heartbeat only adds time', () => {
    expect(dayUpdate(parseVisit({ ...base, t: 30_000, at: '/x' })!, ctx, plain)).toEqual({ durMs: 30_000 });
  });

  it('keys with dots and slashes survive the round trip', () => {
    expect(unFieldKey(fieldKey('/a.b/c%d'))).toBe('/a.b/c%d');
    expect(fieldKey('/a.b')).not.toContain('.');
    expect(fieldKey('')).toBe('(none)');
  });

  it('adds days up and never shows a negative', () => {
    const s = summarize([{ day: 'a', sessions: 2, bounces: 1, durMs: 10, exit: { '%2Fx': 2 } }, { day: 'b', sessions: 1, bounces: -1, exit: { '%2Fx': -1, '%2Fy': 1 } }]);
    expect(s.bounces).toBe(0);
    expect(s.exits).toEqual([{ key: '/x', value: 1 }, { key: '/y', value: 1 }]);
  });
});

describe('period and series', () => {
  it('ranges and the period before', () => {
    expect(period({ range: 'today' }, '2026-10-23', null)).toMatchObject({ from: '2026-10-23', to: '2026-10-23', days: 1, previous: { from: '2026-10-22', to: '2026-10-22' } });
    expect(period({ range: '7d' }, '2026-10-23', null)).toMatchObject({ from: '2026-10-17', to: '2026-10-23', previous: { from: '2026-10-10', to: '2026-10-16' } });
    expect(period({ range: 'all' }, '2026-10-23', '2026-10-22')).toMatchObject({ from: '2026-10-22', days: 2 });
    expect(period({ range: 'custom', from: '2026-10-20', to: '2026-10-01' }, '2026-10-23', null)).toMatchObject({ from: '2026-10-01', to: '2026-10-20', days: 20 });
    // A custom period with a broken date falls back to the default 30 days.
    expect(period({ range: 'custom', from: 'nope', to: '2026-10-01' }, '2026-10-23', null).days).toBe(30);
  });
  it('fills the empty days', () => {
    expect(series([{ day: '2026-10-22', sessions: 3, funnel: { enquire: 1 } }], '2026-10-21', '2026-10-23').map(d => [d.day, d.sessions, d.enquiries]))
      .toEqual([['2026-10-21', 0, 0], ['2026-10-22', 3, 1], ['2026-10-23', 0, 0]]);
  });
});

describe('liveSummary', () => {
  it('counts only the last five minutes', () => {
    const now = 1_000_000_000;
    const s = liveSummary([
      { at: now - 10_000, start: now - 70_000, path: '/sets', cc: 'PK', region: 'Sindh', city: 'Karachi', isNew: true, source: 'social:Instagram' },
      { at: now - 60_000, path: '/sets', cc: 'AE', source: 'direct' },
      { at: now - 6 * 60_000, path: '/old', cc: 'PK' },
    ], now);
    expect(s.visitors).toBe(2);
    expect(s.newVisitors).toBe(1);
    expect(s.pages).toEqual([{ key: '/sets', value: 2 }]);
    expect(s.countries).toEqual([{ key: 'AE', value: 1 }, { key: 'PK', value: 1 }]);
    expect(s.sessions[0]).toMatchObject({ path: '/sets', city: 'Karachi', forMs: 60_000, ago: 10_000 });
  });
});
