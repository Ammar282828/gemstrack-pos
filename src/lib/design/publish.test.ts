import { describe, expect, it, vi } from 'vitest';
import type { DesignPage } from './model';
import { buildPlan, cachedRender, runSteps, wordProblems, type Choices, type Memory, type PlanContext, type PublishDesign, type Senders } from './publish';

const page = (id: string, w: number, h: number): DesignPage => ({ id, label: id, format: 'square', frame: { w, h }, origin: 'master', rev: 0 });
const PAGES = [page('sq', 1080, 1080), page('st', 1080, 1920)];
const blob = (s: string) => new Blob([s], { type: 'image/jpeg' });
const DESIGN: PublishDesign = { name: 'Ruby ring', kind: 'piece', fields: { kicker: '', headline: 'Ruby ring', weight: '21K | 5 g', details: '' }, copy: {}, master: 'sq' };

function fakes(over: Partial<Senders> = {}) {
  const calls: string[] = [];
  const s: Senders = {
    website: vi.fn(async (_b, folder, name) => { calls.push(`website:${folder}:${name}`); return 'Rings/Rings/a.jpg'; }),
    featured: vi.fn(async rel => { calls.push(`featured:${rel}`); return rel; }),
    whatsapp: vi.fn(async (key, _b, _n, caption, piece) => { calls.push(`wa:${key}:${caption}:${piece ?? ''}`); return `msg-${key}`; }),
    story: vi.fn(async () => { calls.push('story'); return 'story-1'; }),
    post: vi.fn(async (_b, caption) => { calls.push(`post:${caption}`); return 'post-1'; }),
    siteReplace: vi.fn(async id => { calls.push(`replace:${id}`); return id; }),
    metaAd: vi.fn(async r => { calls.push(`meta:${r.vertical ? 'both' : 'one'}`); return '/ads/new?studio=k'; }),
    queue: vi.fn(async r => { calls.push(`queue:${Object.keys(r.images).sort().join('+')}:${r.dueAt ?? 'held'}`); return 'q1'; }),
    save: vi.fn(async () => { calls.push('save'); return 'd1'; }),
    record: vi.fn(async () => undefined),
    ...over,
  };
  return { s, calls };
}
const ctx = (s: Senders, o: Partial<PlanContext> = {}): PlanContext => ({
  design: DESIGN, pages: PAGES, render: async (id, px) => blob(`${id}@${px}`), senders: s, ...o,
});
const captions = { wa: 'WA', ig: 'IG', adText: 'ad', adHeadline: 'head' };
const everywhere: Choices = {
  website: { folder: 'Rings/Rings' }, featured: true, whatsapp: ['announcements', 'channel'], instagramStory: 'api', instagramPost: 'api', metaAd: true, captions,
};

describe('buildPlan', () => {
  it('orders the steps and gives each WhatsApp place its own', () => {
    const { s } = fakes();
    const { steps, missing } = buildPlan(ctx(s), everywhere);
    expect(missing).toEqual([]);
    expect(steps.map(x => x.id)).toEqual(['website', 'featured', 'instagram-story', 'wa:announcements', 'wa:channel', 'instagram-post', 'meta-ad']);
  });
  it('a destination whose size the design lacks is missing, not a step', () => {
    const { s } = fakes();
    const only = ctx(s, { pages: [page('st', 1080, 1920)], design: { ...DESIGN, master: 'st' } });
    const { steps, missing } = buildPlan(only, { ...everywhere, metaAd: false });
    expect(steps.map(x => x.id)).toEqual(['instagram-story']);
    expect(missing.map(m => m.dest).sort()).toEqual(['instagram-post', 'website', 'whatsapp']);
    expect(missing.find(m => m.dest === 'whatsapp')?.label).toBe('Make 1:1 from this');
  });
  it('the Meta ad carries the 9:16 page as its second asset', async () => {
    const { s, calls } = fakes();
    const { steps } = buildPlan(ctx(s, { design: { ...DESIGN, master: 'sq' } }), { metaAd: true, captions });
    await runSteps(steps, {});
    expect(calls).toEqual(['meta:both']);
  });
  it('queueing wraps website, WhatsApp and the story in one step; the post and the ad still go on their own', async () => {
    const { s, calls } = fakes();
    const { steps } = buildPlan(ctx(s), { ...everywhere, queue: { dueAt: '2026-10-13T10:00:00.000Z' } });
    expect(steps.map(x => x.id)).toEqual(['queue', 'instagram-post', 'meta-ad']);
    await runSteps(steps, {});
    expect(calls).toContain('queue:site-0+story+wa-0:2026-10-13T10:00:00.000Z');
    expect(calls).toContain('post:IG');
  });
  it('a held queue entry has no time', async () => {
    const { s, calls } = fakes();
    await runSteps(buildPlan(ctx(s), { whatsapp: ['announcements'], queue: { dueAt: null }, captions }).steps, {});
    expect(calls).toEqual(['queue:wa-0:held']);
  });
  it('a site design carries its piece to WhatsApp, and can replace the site photo', async () => {
    const { s, calls } = fakes();
    const c = ctx(s, { design: { ...DESIGN, source: { siteId: 'piece-9' } } });
    await runSteps(buildPlan(c, { whatsapp: ['announcements'], siteReplace: true, captions }).steps, {});
    expect(calls).toEqual(['wa:announcements:WA:piece-9', 'replace:piece-9']);
  });
  it('replacing a site photo needs the piece', () => {
    const { s } = fakes();
    expect(buildPlan(ctx(s), { siteReplace: true, captions }).steps).toEqual([]);
  });
  it('draws each page at each size once, however many places ask', async () => {
    const render = vi.fn(async (id: string, px: number) => blob(`${id}@${px}`));
    const { s } = fakes();
    const { steps } = buildPlan(ctx(s, { render }), { whatsapp: ['announcements', 'diamonds', 'channel'], captions });
    await runSteps(steps, {});
    expect(render.mock.calls.filter(c => c[0] === 'sq' && c[1] === 1600)).toHaveLength(1);
  });
});

describe('runSteps', () => {
  it('runs in order and remembers what went', async () => {
    const { s, calls } = fakes();
    const memory: Memory = {};
    const { steps } = buildPlan(ctx(s), { website: { folder: 'Rings/Rings' }, featured: true, whatsapp: ['announcements'], captions });
    const out = await runSteps(steps, memory);
    expect(out.every(x => x.status === 'done')).toBe(true);
    expect(calls).toEqual(['website:Rings/Rings:Ruby-ring.jpg', 'featured:Rings/Rings/a.jpg', 'wa:announcements:WA:']);
    expect(memory).toMatchObject({ website: 'Rings/Rings/a.jpg', 'wa:announcements': 'msg-announcements' });
  });

  it('retries only what failed — a group that went is never posted twice', async () => {
    let channelUp = false;
    const sent: string[] = [];
    const { s, calls } = fakes({
      whatsapp: vi.fn(async key => {
        if (key === 'channel' && !channelUp) throw Object.assign(new Error('WAHA is down'), { status: 502 });
        sent.push(key); return `msg-${key}`;
      }),
    });
    const memory: Memory = {};
    const { steps } = buildPlan(ctx(s), { website: { folder: 'Rings/Rings' }, whatsapp: ['announcements', 'channel'], instagramStory: 'api', captions });
    const first = await runSteps(steps, memory);
    expect(first.find(x => x.id === 'wa:channel')).toMatchObject({ status: 'failed', error: 'WAHA is down', errStatus: 502 });
    expect(first.filter(x => x.status === 'done').map(x => x.id).sort()).toEqual(['instagram-story', 'wa:announcements', 'website']);
    channelUp = true;
    const again = await runSteps(steps, memory);
    expect(again.every(x => x.status === 'done')).toBe(true);
    expect(sent).toEqual(['announcements', 'channel']);
    expect(calls.filter(c => c === 'story')).toHaveLength(1);
    expect(calls.filter(c => c.startsWith('website'))).toHaveLength(1);
  });

  it('`only` retries one step and leaves the rest alone', async () => {
    const { s, calls } = fakes();
    const { steps } = buildPlan(ctx(s), { whatsapp: ['announcements', 'diamonds'], captions });
    await runSteps(steps, {}, { only: 'wa:diamonds' });
    expect(calls).toEqual(['wa:diamonds:WA:']);
  });

  it('the set of the day does not run, and says why, when the website photo has not gone', async () => {
    const { s, calls } = fakes({ website: vi.fn(async () => { throw new Error('upload failed'); }) });
    const { steps } = buildPlan(ctx(s), { website: { folder: 'Rings/Rings' }, featured: true, captions });
    const out = await runSteps(steps, {});
    expect(out.find(x => x.id === 'website')?.status).toBe('failed');
    expect(out.find(x => x.id === 'featured')).toMatchObject({ status: 'failed', error: 'Website has not gone yet.' });
    expect(calls).toEqual([]);
  });

  it('a share-sheet step waits for the person and is not run', async () => {
    const { s, calls } = fakes();
    const { steps } = buildPlan(ctx(s), { instagramStory: 'share', whatsapp: ['announcements'], captions });
    const out = await runSteps(steps, {});
    expect(out.find(x => x.id === 'instagram-story')?.status).toBe('manual');
    expect(calls).toEqual(['wa:announcements:WA:']);
    expect(steps.find(x => x.id === 'instagram-story')?.share).toBeTypeOf('function');
  });

  it('notes each success on the design, and a failed note never fails the step', async () => {
    const { s } = fakes();
    const noted: string[] = [];
    const { steps } = buildPlan(ctx(s), { website: { folder: 'Rings/Rings' }, whatsapp: ['announcements'], captions });
    const out = await runSteps(steps, {}, { record: async step => { noted.push(step.id); if (step.id === 'website') throw new Error('offline'); } });
    expect(noted).toEqual(['website', 'wa:announcements']);
    expect(out.every(x => x.status === 'done')).toBe(true);
  });

  it('Save runs first and gives the design its id', async () => {
    const { s } = fakes();
    const { steps } = buildPlan(ctx(s, { docOf: id => ({ id }) }), { save: true, whatsapp: ['announcements'], captions });
    const memory: Memory = {};
    await runSteps(steps, memory);
    expect(steps.map(x => x.id)).toEqual(['save', 'wa:announcements']);
    expect(memory.save).toBe('d1');
  });
});

describe('cachedRender', () => {
  it('forgets a failed draw so the retry draws again', async () => {
    let fail = true;
    const inner = vi.fn(async () => { if (fail) throw new Error('canvas'); return blob('x'); });
    const r = cachedRender(inner);
    await expect(r('a', 10)).rejects.toThrow();
    fail = false;
    await r('a', 10); await r('a', 10);
    expect(inner).toHaveBeenCalledTimes(2);
  });
});

describe('wordProblems', () => {
  it('holds the words to the house rules and the specs line', () => {
    expect(wordProblems({ 'WhatsApp caption': 'Big SALE this week! #gold' }, '')).toHaveLength(1);
    const made = wordProblems({ 'Instagram caption': 'A 22k ring, 12 g.' }, '21K | 5 g');
    expect(made[0]).toMatch(/Instagram caption/);
    expect(wordProblems({ 'WhatsApp caption': 'A 21k ring, 5 g.' }, '21K | 5 g')).toEqual([]);
    expect(wordProblems({ x: '   ' }, '')).toEqual([]);
  });
});
