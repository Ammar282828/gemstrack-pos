/**
 * When a draft is written (Drafts, lib/work-drafts.ts; the hook is components/drafts/use-work-drafts.ts).
 *
 * The owner, 2026-10-25: "auto save at every moment so even if I've just written the name a draft gets saved".
 * So a change is written within SAVE_EVERY_MS of being made, not after typing stops; a burst of changes is one
 * write of the newest work (the work is read when the write starts, never captured earlier), and there is never
 * more than one write on its way for a draft. Leaving (the tab hidden, the page closing, the form going) writes at
 * once, whether or not a write is on its way: Firestore queues writes in order, on disk, so the newest lands last.
 *
 * Pure of React and Firestore, so the timing is tested (draft-writer.test.ts).
 */

/** A change reaches Drafts within this long. */
export const SAVE_EVERY_MS = 300;
/** A body bigger than this is not sent by the page-closing beacon (browsers allow ~64 KB for a keepalive request);
 *  the Firestore write, which is queued on disk, carries it. */
export const BEACON_MAX_BYTES = 60_000;

/** What to do with the form's work as it stands. */
export type DraftAction = 'skip' | 'remove' | 'write';

/**
 * `json` is the work as text; `lastJson` what was last written (or loaded); `worth` whether it holds anything
 * (isWorthKeeping). Unchanged work is skipped; emptied work removes its draft, once; the rest is written.
 */
export function draftAction(o: { json: string; lastJson: string; worth: boolean; hasDraft: boolean }): DraftAction {
  if (o.json === o.lastJson) return 'skip';
  if (!o.worth) return o.hasDraft ? 'remove' : 'skip';
  return 'write';
}

/** Whether a body is small enough for the page-closing beacon. */
export const fitsBeacon = (body: string) => body.length <= BEACON_MAX_BYTES;

/**
 * Coalesces `touch()`es into writes. `run` reads the newest work itself when it starts, so whatever was touched
 * since is in it (latest wins).
 *
 *  - touch(): a write is due. None due or on its way: it starts after the rest of SAVE_EVERY_MS since the last one
 *    began (at once after a quiet spell). One already due: nothing changes, it takes the newest. One on its way:
 *    a single follow-up starts when it ends, with the same spacing; never two on their way.
 *  - flush(): writes the newest now, after the one on its way if there is one (the form is going).
 *  - flush(true): the page is going and cannot wait: writes now, on top of one on its way. Firestore keeps writes
 *    in order, on disk, so the newest lands last.
 *  - cancel(): nothing due is written (the draft was finished or discarded).
 */
export class CoalescingWriter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flying: Promise<void> | null = null;
  private dirty = false;
  private lastStart = -Infinity;
  private flushes = 0;

  constructor(
    private readonly run: () => Promise<void>,
    private readonly every = SAVE_EVERY_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Nothing due and nothing on its way. */
  get idle() { return !this.timer && !this.flying; }

  touch() {
    this.dirty = true;
    if (!this.flying && !this.timer) this.arm();
  }

  cancel() {
    this.clear();
    this.dirty = false;
  }

  async flush(force = false) {
    this.clear();
    if (force) {
      this.dirty = false;
      this.lastStart = this.now();
      try { await this.run(); } catch { /* run reports its own failures */ }
      return;
    }
    this.flushes++;
    try {
      while (this.flying) await this.flying;
      await this.write();
    } finally { this.flushes--; }
  }

  private clear() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private arm() {
    const wait = Math.max(0, this.every - (this.now() - this.lastStart));
    this.timer = setTimeout(() => { this.timer = null; void this.write(); }, wait);
  }

  private async write() {
    if (this.flying) return;
    this.dirty = false;
    this.lastStart = this.now();
    const going = this.run().catch(() => { /* run reports its own failures */ });
    this.flying = going;
    await going;
    this.flying = null;
    // Work touched while it was on its way: one more, unless a flush is about to write it.
    if (this.dirty && !this.flushes && !this.timer) this.arm();
  }
}
