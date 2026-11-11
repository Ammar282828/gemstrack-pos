import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from '@/lib/agent/fake-firestore';

// The queue's claim, its send and its final write, against an in-memory Firestore. Nothing is sent; all data made up.
const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db, adminAuth: {} }));
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppFileToGroup: vi.fn(), whatsAppProvider: () => 'waha', sendWhatsAppTextToGroup: vi.fn() }));
vi.mock('@/lib/social/story-post', () => ({ postStoryImage: vi.fn() }));
vi.mock('@/lib/social/feed-post', () => ({ postFeedImages: vi.fn() }));
vi.mock('@/lib/social/errors', () => ({ recordError: vi.fn(async () => undefined) }));
vi.mock('@/lib/website/upload', () => ({ uploadToSite: vi.fn() }));
vi.mock('@/lib/website/featured', () => ({ saveFeatured: vi.fn() }));

const { claimItem, sendItem, changeItem, toView, MAX_TRIES } = await import('./queue');

const T0 = new Date('2026-11-11T10:00:00.000Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const col = () => fake.col('social_queue');

function seed(id: string, over: Record<string, unknown> = {}) {
  col()[id] = {
    id, createdAt: T0.toISOString(), by: 'owner@example.com', status: 'scheduled', dueAt: T0.toISOString(), headline: 'Ring', caption: 'c', fileBase: 'ring',
    website: { folder: 'Rings/New', collection: 'New', names: ['a.jpg', 'b.jpg', 'c.jpg'], featured: false }, instagram: false, whatsapp: [],
    counts: { site: 3, wa: 0, story: false }, stored: { 'site-0': 1, 'site-1': 1, 'site-2': 1 }, done: {}, errors: {}, attempts: 0, claimedAt: null, ...over,
  };
  for (const k of ['site-0', 'site-1', 'site-2']) fake.col('social_queue_media')[`${id}__${k}__0`] = { data: Buffer.from(k) };
}
const stored = (id: string) => col()[id] as Record<string, any>;
const okSites = (calls: string[] = []) => ({ site: async (_b: Blob, _f: string, name: string) => { calls.push(name); return `Rings/${name}`; } });

beforeEach(() => fake.reset());

describe('claiming', () => {
  it('the tick takes a scheduled piece whose time has come, once, under a token', async () => {
    seed('a');
    expect(await claimItem('a', min(-1))).toBeNull();
    const c = await claimItem('a', T0);
    expect(c).toMatchObject({ status: 'sending', attempts: 1 });
    expect(c!.claimToken).toBeTruthy();
    expect(await claimItem('a', min(1))).toBeNull();
  });

  it('a held piece is only sent by Send now; a piece out of tries waits for the counter', async () => {
    seed('h', { status: 'held', dueAt: null });
    expect(await claimItem('h', min(5))).toBeNull();
    expect((await claimItem('h', min(5), true))?.status).toBe('sending');
    seed('t', { status: 'failed', attempts: MAX_TRIES });
    expect(await claimItem('t', min(5))).toBeNull();
    expect((await claimItem('t', min(5), true))?.status).toBe('sending');
  });

  it('never a draft or a sent piece', async () => {
    seed('d', { status: 'draft' }); seed('s', { status: 'sent' });
    expect(await claimItem('d', T0, true)).toBeNull();
    expect(await claimItem('s', T0, true)).toBeNull();
  });

  it('an AI piece nobody approved is taken only by an approver, who approves it', async () => {
    seed('ai', { proposedBy: 'ChatGPT', status: 'held' });
    expect(await claimItem('ai', T0)).toBeNull();
    expect(await claimItem('ai', T0, true)).toBeNull();
    const c = await claimItem('ai', T0, true, 'owner@example.com');
    expect(c).toMatchObject({ status: 'sending', approvedBy: 'owner@example.com' });
  });

  it('a live claim cannot be taken over; a lapsed one can, and the takeover is recorded with a new token', async () => {
    seed('a');
    const first = await claimItem('a', T0, true);
    expect(await claimItem('a', min(9), true)).toBeNull();
    const second = await claimItem('a', min(11), true);
    expect(second).toMatchObject({ status: 'sending', attempts: 2 });
    expect(second!.claimToken).not.toBe(first!.claimToken);
    expect(stored('a').takeovers).toEqual([{ at: min(11).toISOString(), claimedAt: T0.toISOString(), token: first!.claimToken, done: 0 }]);
    // The tick's takeover also needs its tries.
    seed('b', { status: 'sending', claimedAt: T0.toISOString(), attempts: MAX_TRIES });
    expect(await claimItem('b', min(11))).toBeNull();
  });
});

describe('sending', () => {
  it('sends every unit, records each, and ends sent with the images cleared', async () => {
    seed('a');
    const calls: string[] = [];
    const item = (await claimItem('a', T0))!;
    const after = await sendItem(item, { by: 'schedule', origin: 'https://erp.example', senders: okSites(calls) });
    expect(calls).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(after.status).toBe('sent');
    expect(stored('a')).toMatchObject({ status: 'sent', claimedAt: null, errors: {}, stored: {} });
    expect(Object.keys(stored('a').done)).toEqual(['site-0', 'site-1', 'site-2']);
    expect(stored('a').sentAt).toBeTruthy();
    expect(Object.keys(fake.col('social_queue_media'))).toHaveLength(0);
  });

  it('a unit that fails leaves the piece failed with its error, and a retry sends only what is left', async () => {
    seed('a');
    let n = 0;
    const flaky = { site: async (_b: Blob, _f: string, name: string) => { if (name === 'b.jpg' && n++ === 0) throw new Error('boom'); return `R/${name}`; } };
    const after = await sendItem((await claimItem('a', T0))!, { by: 'schedule', origin: 'o', senders: flaky });
    expect(after.status).toBe('failed');
    expect(stored('a')).toMatchObject({ status: 'failed', claimedAt: null });
    expect(stored('a').errors['site-1'].message).toBe('boom');
    expect(Object.keys(stored('a').done)).toEqual(['site-0', 'site-2']);
    const calls: string[] = [];
    const again = await sendItem((await claimItem('a', min(1), true))!, { by: 'x', origin: 'o', senders: okSites(calls) });
    expect(calls).toEqual(['b.jpg']);
    expect(again.status).toBe('sent');
    expect(stored('a').errors).toEqual({});
  });

  it('a hold made during the send is kept: the piece stays held, the results are recorded, and the send stops', async () => {
    seed('a');
    const calls: string[] = [];
    const holdsAfterFirst = { site: async (_b: Blob, _f: string, name: string) => {
      calls.push(name);
      // The counter's hold (after the lease lapsed) lands while this send is in flight.
      if (name === 'a.jpg') col().a = { ...stored('a'), status: 'held', dueAt: null, claimedAt: null };
      return `R/${name}`;
    } };
    const after = await sendItem((await claimItem('a', T0))!, { by: 'schedule', origin: 'o', senders: holdsAfterFirst });
    expect(calls).toEqual(['a.jpg']);
    expect(after.status).toBe('held');
    expect(stored('a')).toMatchObject({ status: 'held', dueAt: null, claimedAt: null });
    expect(Object.keys(stored('a').done)).toEqual(['site-0']);
    expect(Object.keys(fake.col('social_queue_media'))).toHaveLength(3);
  });

  it('a time set during the send (unschedule/reschedule) is kept too', async () => {
    seed('a');
    const later = min(120).toISOString();
    const moves = { site: async (_b: Blob, _f: string, name: string) => { col().a = { ...stored('a'), status: 'scheduled', dueAt: later, claimedAt: null, attempts: 0 }; return `R/${name}`; } };
    const after = await sendItem((await claimItem('a', T0))!, { by: 'schedule', origin: 'o', senders: moves });
    expect(after.status).toBe('scheduled');
    expect(stored('a')).toMatchObject({ status: 'scheduled', dueAt: later, attempts: 0 });
    expect(Object.keys(stored('a').done)).toEqual(['site-0']);
  });

  it('a slow send taken over after its lease lapsed does not resend what is done, and cannot overwrite the new sender', async () => {
    seed('a');
    const first = (await claimItem('a', T0))!;
    const callsA: string[] = [], callsB: string[] = [];
    let second: Awaited<ReturnType<typeof claimItem>> = null;
    let afterB: Awaited<ReturnType<typeof sendItem>> | null = null;
    const slow = { site: async (_b: Blob, _f: string, name: string) => {
      callsA.push(name);
      if (name === 'a.jpg') {
        // While this send is stuck, its lease lapses and the tick's Send takes the piece over and finishes it.
        col().a = { ...stored('a'), claimedAt: new Date(Date.now() - 11 * 60_000).toISOString() };
        second = await claimItem('a', new Date(), true);
        afterB = await sendItem(second!, { by: 'tick', origin: 'o', senders: okSites(callsB) });
      }
      return `R/${name}`;
    } };
    const afterA = await sendItem(first, { by: 'schedule', origin: 'o', senders: slow });
    expect(second).not.toBeNull();
    expect(second!.claimToken).not.toBe(first.claimToken);
    // A did a.jpg (in flight when taken over) and stopped; B did only what was not done by then (it saw done['site-0']? no: A's record came after).
    expect(callsA).toEqual(['a.jpg']);
    expect(callsB).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(afterB!.status).toBe('sent');
    // A's late final write recorded nothing over the finished piece.
    expect(afterA.status).toBe('sent');
    expect(stored('a')).toMatchObject({ status: 'sent', claimedAt: null });
    expect(stored('a').takeovers).toHaveLength(1);
  });

  it('a takeover skips every unit already recorded as done', async () => {
    seed('a', { status: 'sending', claimedAt: T0.toISOString(), attempts: 1, claimToken: 'old', done: { 'site-0': 'R/a.jpg', 'site-1': 'R/b.jpg' } });
    const calls: string[] = [];
    const c = (await claimItem('a', min(11), true))!;
    expect(stored('a').takeovers![0]).toMatchObject({ token: 'old', done: 2 });
    await sendItem(c, { by: 'x', origin: 'o', senders: okSites(calls) });
    expect(calls).toEqual(['c.jpg']);
    expect(stored('a').status).toBe('sent');
  });

  it('a piece deleted during the send does not come back', async () => {
    seed('a');
    const gone = { site: async (_b: Blob, _f: string, name: string) => { delete col().a; return `R/${name}`; } };
    await sendItem((await claimItem('a', T0))!, { by: 'x', origin: 'o', senders: gone });
    expect(col().a).toBeUndefined();
  });
});

describe('the counter, and what the list shows', () => {
  it('a stalled "sending" is shown as a retry, honestly named; the store keeps "sending"; a live one shows as sending', () => {
    seed('a', { status: 'sending', claimedAt: new Date(Date.now() - 11 * 60_000).toISOString(), claimToken: 'tok' });
    const view = toView(stored('a') as never);
    expect(view).toMatchObject({ status: 'failed', stalled: true });
    expect(view.errors.stalled.message).toBe('Stuck sending — retry');
    expect('claimToken' in view).toBe(false);
    expect(stored('a').status).toBe('sending');
    seed('b', { status: 'sending', claimedAt: new Date().toISOString() });
    expect(toView(stored('b') as never)).toMatchObject({ status: 'sending', stalled: false });
    seed('c', { status: 'failed' });
    expect(toView(stored('c') as never)).toMatchObject({ status: 'failed', stalled: false });
  });

  it('hold: a live send refuses it, a stalled one becomes Failed (so the list says what is left), others become Held', async () => {
    seed('live', { status: 'sending', claimedAt: new Date().toISOString() });
    await expect(changeItem('live', { action: 'hold' })).rejects.toMatchObject({ status: 409, message: 'That piece is being sent right now.' });
    seed('dead', { status: 'sending', claimedAt: new Date(Date.now() - 11 * 60_000).toISOString(), claimToken: 'tok' });
    expect(await changeItem('dead', { action: 'hold' })).toMatchObject({ status: 'failed', dueAt: null, claimedAt: null });
    expect(stored('dead').claimToken).toBe('tok');
    seed('s'); expect((await changeItem('s', { action: 'hold' })).status).toBe('held');
    seed('f', { status: 'failed' }); expect((await changeItem('f', { action: 'hold' })).status).toBe('failed');
    seed('sent', { status: 'sent' });
    await expect(changeItem('sent', { action: 'hold' })).rejects.toMatchObject({ status: 409 });
  });

  it('schedule gives a failed piece its tries back; an AI piece needs approval first', async () => {
    seed('f', { status: 'failed', attempts: 3 });
    expect(await changeItem('f', { action: 'schedule', dueAt: min(30).toISOString() })).toMatchObject({ status: 'scheduled', attempts: 0 });
    seed('ai', { status: 'held', proposedBy: 'ChatGPT' });
    await expect(changeItem('ai', { action: 'schedule', dueAt: min(30).toISOString() })).rejects.toThrow(/approve it first/);
    expect(await changeItem('ai', { action: 'schedule', dueAt: min(30).toISOString(), by: 'owner@example.com' })).toMatchObject({ status: 'scheduled', approvedBy: 'owner@example.com' });
  });
});

