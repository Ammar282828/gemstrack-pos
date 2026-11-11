/**
 * The social post queue (lib/social/queue.ts): `social_queue/<id>.status`. Declared 2026-11-11 after three bugs: the
 * final sent/failed write ignored a hold made during the send, a slow send could be taken over and sent twice, and the
 * list showed a dead "sending" as "failed" though the stored word was "sending".
 *
 * Approval is a guard, not a state: a piece an outside AI queued (`proposedBy`) with no `approvedAt` is `held` like any
 * other, but nothing schedules or claims it until a person's Approve (or a key with posts:publish) says so. Every other
 * move is the one the queue already made. `claim` is the tick's (needs its time and a try left); `claimNow` is the
 * counter's Send now. A `sending` piece's claim is a lease (10 minutes, renewed by each unit that goes): only once it
 * lapses can the piece be claimed again (a takeover, recorded in `takeovers`), and a unit already in `done` is never
 * sent again. `sent` and `fail` are the sender's own final write, made only while the piece is still `sending` under the
 * sender's own claim token; a hold or a time set meanwhile is kept, and the results are recorded beside it.
 */
import { defineMachine } from './machine';

export const QUEUE_STATES = ['draft', 'held', 'scheduled', 'sending', 'sent', 'failed'] as const;
export type QueueState = typeof QUEUE_STATES[number];
export interface QueueCtx {
  /** The claim's 10-minute lease has not run out. */
  leaseLive: boolean;
  /** An AI's piece that nobody (this call included) has approved. */
  needsApproval: boolean;
  /** Its time has come (tick only). */
  due: boolean;
  /** It has tries left (tick only). */
  triesLeft: boolean;
}

const lapsed = (c: QueueCtx) => (c.leaseLive ? 'That piece is being sent right now.' : null);
const approved = (c: QueueCtx) => (c.needsApproval ? 'An AI made this piece: approve it first (its own Approve, in Posts).' : null);
const all = (...fs: ((c: QueueCtx) => string | null)[]) => (c: QueueCtx) => { for (const f of fs) { const r = f(c); if (r) return r; } return null; };
const tick = all(approved, c => (c.due ? null : 'Its time has not come.'), c => (c.triesLeft ? null : 'It has had its tries: the counter sends it.'));

export const QUEUE = defineMachine<QueueState, QueueCtx>({
  name: 'Post queue',
  field: 'social_queue/<id>.status',
  states: QUEUE_STATES,
  labels: { draft: 'Arriving', held: 'Held', scheduled: 'Scheduled', sending: 'Sending', sent: 'Sent', failed: 'Failed' },
  tones: { draft: 'quiet', held: 'quiet', scheduled: 'owed', sending: 'working', sent: 'settled', failed: 'late' },
  final: ['sent'],
  // A takeover is sending → sending, so a move to the same state is never a quiet no-op here.
  sameIsNoop: false,
  moves: [
    { from: ['draft'], to: 'held', event: 'ready', note: 'every image has arrived' },
    { from: ['scheduled', 'held'], to: 'held', event: 'hold', note: 'keeps it until told' },
    { from: ['failed'], to: 'failed', event: 'hold', note: 'clears its time; it stays Failed' },
    { from: ['sending'], to: 'failed', event: 'hold', guard: lapsed, guardNote: 'its claim has lapsed', note: 'something may have gone: it stays Failed so the list says what is left' },
    { from: ['held', 'scheduled', 'failed'], to: 'scheduled', event: 'schedule', guard: approved, guardNote: 'approved if an AI made it', note: 'also how a failed piece gets its tries back' },
    { from: ['sending'], to: 'scheduled', event: 'schedule', guard: all(lapsed, approved), guardNote: 'its claim has lapsed; approved if an AI made it' },
    { from: ['scheduled', 'failed'], to: 'sending', event: 'claim', guard: tick, guardNote: 'its time has come, tries left, approved', note: 'the five-minute tick' },
    { from: ['sending'], to: 'sending', event: 'claim', guard: all(lapsed, tick), guardNote: 'its claim has lapsed, its time has come, tries left, approved', note: 'a takeover; recorded in takeovers, and no unit already done is sent again' },
    { from: ['held', 'scheduled', 'failed'], to: 'sending', event: 'claimNow', guard: approved, guardNote: 'approved if an AI made it', note: 'Send now' },
    { from: ['sending'], to: 'sending', event: 'claimNow', guard: all(lapsed, approved), guardNote: 'its claim has lapsed; approved if an AI made it', note: 'a takeover, as above' },
    { from: ['sending'], to: 'sent', event: 'sent', note: 'every unit is done; only while still Sending under the sender’s own claim' },
    { from: ['sending'], to: 'failed', event: 'fail', note: 'some units did not go; only while still Sending under the sender’s own claim' },
  ],
});

/** What a queue list shows for a piece whose claim lapsed while it said "sending": it keeps its stored state, the view says so. */
export const STALLED_MESSAGE = 'Stuck sending — retry';
