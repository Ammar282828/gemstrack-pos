/**
 * A rate limit kept in this server's memory, for the public reads (prices).
 *
 * The Firestore limiter (ratelimit.ts) is right for writes — an order, a sign-in — where a script
 * must be stopped across every instance. For a price lookup it cost a database transaction per
 * visitor's page, on one document per address; and on Pakistan's mobile networks hundreds of phones
 * share an address, so a crowd would have queued on that one document and then been refused
 * together. Here each instance counts on its own (a few instances at most means a few times the
 * allowance at worst), which is plenty to make scraping boring and costs nothing.
 */

const windows = new Map<string, { start: number; count: number }>();
let sweptAt = 0;

export function memoryLimit(scope: string, caller: string, max: number, windowSeconds: number): { ok: boolean; retryAfter: number } {
  const now = Date.now(), windowMs = windowSeconds * 1000, key = `${scope}:${caller}`;
  // Forget finished windows now and then, so the map can't grow without end.
  if (now - sweptAt > 60_000) { sweptAt = now; for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k); }
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) { windows.set(key, { start: now, count: 1 }); return { ok: true, retryAfter: 0 }; }
  w.count++;
  return { ok: w.count <= max, retryAfter: Math.ceil((w.start + windowMs - now) / 1000) };
}
