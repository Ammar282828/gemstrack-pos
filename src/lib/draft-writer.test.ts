import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEACON_MAX_BYTES, CoalescingWriter, SAVE_EVERY_MS, draftAction, fitsBeacon } from './draft-writer';

describe('draftAction', () => {
  it('skips work that has not changed', () => {
    expect(draftAction({ json: '{"a":1}', lastJson: '{"a":1}', worth: true, hasDraft: true })).toBe('skip');
  });
  it('writes the first thing typed, a customer name alone included', () => {
    expect(draftAction({ json: '{"customerName":"A"}', lastJson: '', worth: true, hasDraft: false })).toBe('write');
  });
  it('writes a change to a draft', () => {
    expect(draftAction({ json: '{"customerName":"Al"}', lastJson: '{"customerName":"A"}', worth: true, hasDraft: true })).toBe('write');
  });
  it('removes a draft whose form was emptied, and does nothing for a blank form with no draft', () => {
    expect(draftAction({ json: '{}', lastJson: '{"a":1}', worth: false, hasDraft: true })).toBe('remove');
    expect(draftAction({ json: '{"b":0}', lastJson: '', worth: false, hasDraft: false })).toBe('skip');
  });
});

describe('fitsBeacon', () => {
  it('keeps the page-closing request under the browsers keepalive allowance', () => {
    expect(fitsBeacon('x'.repeat(BEACON_MAX_BYTES))).toBe(true);
    expect(fitsBeacon('x'.repeat(BEACON_MAX_BYTES + 1))).toBe(false);
  });
});

describe('CoalescingWriter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** A run that stays on its way until the test lets it end. */
  function slowRun() {
    const ends: Array<() => void> = [];
    const run = vi.fn(() => new Promise<void>(resolve => { ends.push(resolve); }));
    return { run, end: () => ends.shift()?.() };
  }

  it('writes at once after a quiet spell, not after typing stops', async () => {
    const run = vi.fn(async () => {});
    const w = new CoalescingWriter(run);
    w.touch();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('writes a steady typist every SAVE_EVERY_MS, one write for each burst', async () => {
    const run = vi.fn(async () => {});
    const w = new CoalescingWriter(run);
    // A key every 50 ms for a second: the first at once, then one write per 300 ms, never one per key.
    for (let t = 0; t < 1000; t += 50) {
      w.touch();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(run.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('takes the newest work: one write for a burst inside the interval', async () => {
    const run = vi.fn(async () => {});
    const w = new CoalescingWriter(run);
    w.touch();
    await vi.advanceTimersByTimeAsync(0);      // first write
    for (let i = 0; i < 5; i++) { w.touch(); await vi.advanceTimersByTimeAsync(20); }
    await vi.advanceTimersByTimeAsync(SAVE_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);      // the burst of five is one write
  });

  it('never has two writes on their way', async () => {
    const { run, end } = slowRun();
    const w = new CoalescingWriter(run);
    w.touch();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i++) { w.touch(); await vi.advanceTimersByTimeAsync(100); }
    expect(run).toHaveBeenCalledTimes(1);      // still the first
    end();
    await vi.advanceTimersByTimeAsync(SAVE_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);      // one follow-up with the newest
    await vi.advanceTimersByTimeAsync(5 * SAVE_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);      // and nothing more until something changes
    end();
  });

  it('does nothing when nothing was touched', async () => {
    const run = vi.fn(async () => {});
    new CoalescingWriter(run);
    await vi.advanceTimersByTimeAsync(10 * SAVE_EVERY_MS);
    expect(run).not.toHaveBeenCalled();
  });

  it('flush writes now, after the write on its way', async () => {
    const { run, end } = slowRun();
    const w = new CoalescingWriter(run);
    w.touch();
    await vi.advanceTimersByTimeAsync(0);
    w.touch();
    let done = false;
    const flushed = w.flush().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    end();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);      // the newest, straight away, not after the interval
    end();
    await flushed;
    expect(done).toBe(true);
  });

  it('flush(true) writes at once on top of one on its way (the page is closing)', async () => {
    const { run } = slowRun();
    const w = new CoalescingWriter(run);
    w.touch();
    await vi.advanceTimersByTimeAsync(0);
    void w.flush(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('flush with a write due writes it now and the timer does not write it again', async () => {
    const run = vi.fn(async () => {});
    const w = new CoalescingWriter(run);
    w.touch();
    await vi.advanceTimersByTimeAsync(0);
    w.touch();                                  // due in SAVE_EVERY_MS
    await w.flush();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * SAVE_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel drops what was due', async () => {
    const run = vi.fn(async () => {});
    const w = new CoalescingWriter(run);
    w.touch();
    await vi.advanceTimersByTimeAsync(0);
    w.touch();
    w.cancel();
    await vi.advanceTimersByTimeAsync(2 * SAVE_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(1);
    expect(w.idle).toBe(true);
  });

  it('a failing write does not stop the next', async () => {
    const run = vi.fn(async () => { throw new Error('offline'); });
    const w = new CoalescingWriter(run);
    w.touch();
    await vi.advanceTimersByTimeAsync(0);
    w.touch();
    await vi.advanceTimersByTimeAsync(SAVE_EVERY_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
