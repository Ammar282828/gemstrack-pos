/**
 * A short server-side memory for Meta's answers, shared by the Ads and Insights routes.
 *
 * - Younger than `ttl`: answered from memory.
 * - Older, but younger than `stale`: answered from memory at once, and asked again in the
 *   background, so the next visit has the new numbers and nobody waits on Meta for them.
 * - Older still, nothing kept, or `fresh` (the Refresh button): asked now.
 * - Two callers asking for the same key at once share one trip to Meta.
 *
 * Per server instance (App Hosting may run several, and none when idle), so a miss is normal.
 *
 * Server-only.
 */

const kept = new Map<string, { at: number; body: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

function run<T>(key: string, build: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const job = build()
    .then(body => { kept.set(key, { at: Date.now(), body }); return body; })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

export async function remembered<T>(key: string, build: () => Promise<T>, opts: { ttl: number; stale: number; fresh?: boolean }): Promise<T> {
  const hit = kept.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && !opts.fresh) {
    if (age < opts.ttl) return hit.body as T;
    if (age < opts.stale) {
      run(key, build).catch(e => console.warn('[ads] background refresh failed:', key, e instanceof Error ? e.message : e));
      return hit.body as T;
    }
  }
  return run(key, build);
}
