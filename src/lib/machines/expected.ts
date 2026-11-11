/**
 * A move queued offline names only where it wants to go, so one that replays weeks later lands over whatever happened
 * meanwhile. A write that is given `from` (the status the person saw when they chose) calls this inside its transaction:
 * when the stored status is neither that nor already the target, nothing is applied and the 409 says it changed meanwhile.
 * Absent `from` the write behaves as before. Pure.
 */
import { MoveRefused, movesFrom, type Machine } from './machine';

export function assertStillIn<S extends string, C>(
  m: Machine<S, C>, thing: 'order' | 'repair', current: string | null | undefined, expectedFrom: string | null | undefined, to: S, ctx: C,
): void {
  const cur = String(current ?? '');
  const was = String(expectedFrom ?? '').trim();
  if (!was || cur === was || cur === to) return; // already there is the same quiet success a repeat always was
  const label = (s: string) => (m.states.includes(s as S) ? m.labels[s as S] : s || 'none');
  const known = m.states.includes(cur as S);
  throw new MoveRefused(m.name, cur, to, known ? movesFrom(m, cur as S, ctx) : [],
    `This ${thing} is now ${label(cur)}: your change to ${label(to)} from ${label(was)} wasn't applied.`);
}
