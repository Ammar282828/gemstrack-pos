import { describe, expect, it } from 'vitest';
import {
  bestHours, byKind, findings, followsOf, kindOf, mediaValues, nonFollowerShare, onlineHours, partsOf, previousWindow,
  rateOf, seriesOf, sharesOf, splitBySurface, totalsOf, unixWindow, windowFor, type PostRow,
} from './shape';

// 2026-10-17 10:00 in Karachi
const NOW = Date.parse('2026-10-17T05:00:00Z');

describe('ranges', () => {
  it('counts Karachi days, today included', () => {
    expect(windowFor('last_7d', NOW)).toEqual({ since: '2026-10-11', until: '2026-10-17', days: 7 });
    expect(windowFor('last_28d', NOW)).toEqual({ since: '2026-09-20', until: '2026-10-17', days: 28 });
    expect(windowFor('this_month', NOW)).toEqual({ since: '2026-10-01', until: '2026-10-17', days: 17 });
    // Just after midnight in Karachi is already the next day.
    expect(windowFor('last_7d', Date.parse('2026-10-16T19:30:00Z')).until).toBe('2026-10-17');
  });
  it('puts the period before right behind it, and stops Meta at now', () => {
    expect(previousWindow({ since: '2026-10-11', until: '2026-10-17', days: 7 })).toEqual({ since: '2026-10-04', until: '2026-10-10', days: 7 });
    const u = unixWindow({ since: '2026-10-11', until: '2026-10-17', days: 7 }, NOW);
    expect(u.since).toBe(Date.parse('2026-10-10T19:00:00Z') / 1000);
    expect(u.until).toBe(NOW / 1000);
  });
});

describe('reading Meta', () => {
  const body = { data: [
    { name: 'reach', total_value: { value: 18556, breakdowns: [{ results: [
      { dimension_values: ['AD'], value: 17571 }, { dimension_values: ['STORY'], value: 10 }, { dimension_values: ['POST'], value: 700 }, { dimension_values: ['REEL'], value: 260 },
    ] }] } },
    { name: 'views', total_value: { value: 24830 } },
  ] };
  it('takes totals, parts and day-by-day values', () => {
    expect(totalsOf(body)).toEqual({ reach: 18556, views: 24830 });
    expect(partsOf(body)[0]).toEqual({ key: 'AD', value: 17571 });
    expect(seriesOf({ data: [{ name: 'reach', values: [{ value: 5, end_time: '2026-10-16T07:00:00+0000' }] }] })).toEqual([{ date: '2026-10-16', value: 5 }]);
  });
  it('splits paid from organic, and reads follows and new people', () => {
    const s = splitBySurface(partsOf(body));
    expect(s.ads).toBe(17571);
    expect(s.organic).toBe(970);
    expect(s.adsShare).toBeCloseTo(0.9477, 3);
    expect(s.bySurface.map(p => p.key)).toEqual(['POST', 'REEL', 'STORY']);
    expect(followsOf([{ key: 'FOLLOWER', value: 1515 }, { key: 'NON_FOLLOWER', value: 32 }])).toEqual({ follows: 1515, unfollows: 32, net: 1483 });
    expect(nonFollowerShare([{ key: 'FOLLOWER', value: 25 }, { key: 'NON_FOLLOWER', value: 75 }])).toBe(0.75);
    expect(splitBySurface([]).adsShare).toBeNull();
  });
  it('merges a media item’s answers, totalling reactions by type', () => {
    expect(mediaValues({ data: [{ name: 'reach', values: [{ value: 1194 }] }, { name: 'post_reactions_by_type_total', values: [{ value: { like: 3, love: 2 } }] }] }, { data: [{ name: 'views', total_value: { value: 9 } }] }))
      .toEqual({ reach: 1194, post_reactions_by_type_total: 5, views: 9 });
    expect(kindOf('REELS', 'VIDEO')).toBe('reel');
    expect(kindOf('FEED', 'CAROUSEL_ALBUM')).toBe('carousel');
    expect(kindOf('STORY', 'IMAGE')).toBe('story');
    expect(rateOf(23, 1194)).toBeCloseTo(0.0193, 3);
    expect(rateOf(null, 10)).toBeNull();
  });
});

describe('audience', () => {
  it('turns counts into shares with an Other', () => {
    const s = sharesOf([{ key: 'a', value: 6 }, { key: 'b', value: 3 }, { key: 'c', value: 1 }], 2);
    expect(s.map(x => [x.key, x.share])).toEqual([['a', 0.6], ['b', 0.3], ['Other', 0.1]]);
  });
  it('moves Meta’s Pacific hours to Karachi and finds the best two', () => {
    // October: Pacific daylight time, UTC−7, so Karachi is 12 hours ahead.
    const hours = onlineHours({ '8': 50, '9': 40, '0': 1 }, '2026-10-17T07:00:00+0000')!;
    expect(hours[20]).toBe(50);
    expect(hours[21]).toBe(40);
    expect(hours[12]).toBe(1);
    expect(bestHours(hours)).toEqual({ start: 20, share: 90 / 91 });
    expect(onlineHours({}, undefined)).toBeNull();
    expect(bestHours(null)).toBeNull();
  });
});

const row = (kind: PostRow['kind'], reach: number, interactions: number): PostRow => ({
  id: `${kind}${reach}`, platform: 'instagram', kind, at: '2026-10-01', caption: '', thumb: null, link: null, reach, views: reach, likes: 0, comments: 0,
  shares: 0, saves: 0, interactions, profileVisits: null, follows: null, avgWatchMs: null, facebookViews: null, clicks: null, replies: null, rate: rateOf(interactions, reach),
});

describe('what it means', () => {
  it('compares formats by their medians', () => {
    const k = byKind([row('reel', 3000, 90), row('reel', 1000, 20), row('post', 400, 8), row('post', 600, 12), row('post', 500, 10)]);
    expect(k[0]).toMatchObject({ kind: 'post', n: 3, medianReach: 500 });
    expect(k[1]).toMatchObject({ kind: 'reel', n: 2, medianReach: 2000 });
  });
  it('says only what the data is big enough to say', () => {
    const f = findings({
      reachSplit: { ads: 17571, organic: 970, adsShare: 0.9477, bySurface: [] },
      nonFollowerReach: 0.2, follows: { follows: 28, unfollows: 13, net: 15 }, followers: 2257,
      kinds: byKind([row('reel', 3000, 90), row('reel', 1000, 20), row('post', 400, 8), row('post', 600, 12)]),
      profileViews: 511, websiteTaps: 0,
      followerCountries: [{ key: 'GB', value: 50, share: 0.5 }, { key: 'PK', value: 30, share: 0.3 }],
      best: { start: 20, share: 0.2 }, paidSpend: 1000, currency: 'PKR',
    });
    const titles = f.map(x => x.title).join(' | ');
    expect(titles).toContain('95% of the reach came from ads');
    expect(titles).toContain('A reel reaches 4.0×');
    expect(titles).toContain('Only 20% of the reach was new people');
    expect(titles).toContain('Few profile visitors tap the link');
    expect(titles).toContain('Only 30% of followers are in Pakistan');
    expect(titles).toContain('8pm–10pm');
    expect(titles).not.toContain('followers (');
    expect(findings({ reachSplit: null, nonFollowerReach: null, follows: null, followers: null, kinds: [], profileViews: null, websiteTaps: null, followerCountries: [], best: null, paidSpend: 0, currency: 'PKR' })).toEqual([]);
  });
});

describe('posting and the post carrying the month', () => {
  const base = { reachSplit: null, nonFollowerReach: null, follows: null, followers: null, kinds: [], profileViews: null, websiteTaps: null, followerCountries: [], best: null, paidSpend: 0, currency: 'PKR' };
  it('notices a quiet account and an old reel doing the work', () => {
    const f = findings({ ...base, now: NOW, lastPostAt: '2026-09-16T10:00:00+0000', totalViews: 249016, topPost: { kind: 'reel', at: '2026-07-28T10:00:00+0000', views: 120000, older: true } });
    expect(f.map(x => x.title)).toEqual(['No Instagram post for 30 days', 'An older reel is carrying the numbers']);
    expect(findings({ ...base, now: NOW, lastPostAt: '2026-10-15T10:00:00+0000', totalViews: 1000, topPost: { kind: 'reel', at: '2026-10-15', views: 900, older: false } })).toEqual([]);
  });
});
