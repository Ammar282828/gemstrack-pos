/**
 * The shop's state machines, declared once (2026-11-10: the status fields were written from a dozen places with no table of
 * which moves are allowed, so a cancelled order could be reopened over its invoice, a refund written as a plain label, a
 * repair collected with money owing). Each machine names its states, which are final, and every move: from where, by what
 * event, and the condition it needs. Writers ask `check()` inside their transaction and refuse with its reason; screens and
 * agents ask `movesFrom()` for what can happen next. `lib/machines/export.ts` writes the same tables as JSON for the iPhone
 * and Android apps and as Markdown for people and agents (docs/state-machines.md), and a test fails when either is stale.
 *
 * Pure: no Firestore, no React. The rules here are the ones the shop already followed; a move that was allowed before stays
 * allowed unless it was a bug (each refusal says which).
 */

export interface Move<S extends string, C> {
  from: readonly S[] | '*';
  to: S;
  /** Who or what makes the move: 'set' is a person choosing it; the others are named actions or the server's own runs. */
  event: string;
  /** Plain words for the docs and the export. */
  note?: string;
  /** A condition on the record; returns the refusal in the shop's words, or null when the move may go ahead. */
  guard?: (ctx: C) => string | null;
  /** The guard in words, for the docs and the apps (which cannot run the function). */
  guardNote?: string;
}

export interface Machine<S extends string, C = Record<string, never>> {
  name: string;
  /** Where the state lives, for the docs: collection and field. */
  field: string;
  states: readonly S[];
  /** Words people read for each state. */
  labels: Record<S, string>;
  /** Colour family from lib/tones.ts. */
  tones: Record<S, 'late' | 'owed' | 'settled' | 'credit' | 'working' | 'quiet' | 'house'>;
  /** States nothing leaves, except by the events listed in `moves`. */
  final: readonly S[];
  moves: readonly Move<S, C>[];
  /** What a move from a state to itself does: allowed and writes nothing (true), or refused. */
  sameIsNoop?: boolean;
}

export type Verdict<S extends string> =
  | { ok: true; noop: boolean; move?: { event: string } }
  | { ok: false; reason: string; allowed: { to: S; event: string }[] };

export const defineMachine = <S extends string, C>(m: Machine<S, C>): Machine<S, C> => m;

const fromOk = <S extends string>(from: readonly S[] | '*', s: S) => from === '*' || from.includes(s);

/** Every move the machine allows out of `from` by `event` (any event when omitted), with its guard applied when ctx is given. */
export function movesFrom<S extends string, C>(m: Machine<S, C>, from: S, ctx?: C, event?: string): { to: S; event: string }[] {
  return m.moves
    .filter(mv => fromOk(mv.from, from) && mv.to !== from && (!event || mv.event === event) && (!ctx || !mv.guard || mv.guard(ctx) === null))
    .map(mv => ({ to: mv.to, event: mv.event }));
}

/** May `from` become `to` by `event`? A stored state the machine does not know (old data) takes any move by that event, guard still applied. */
export function check<S extends string, C>(m: Machine<S, C>, from: string | null | undefined, to: S, event: string, ctx: C): Verdict<S> {
  const cur = (from ?? '') as S;
  if (cur === to && m.sameIsNoop !== false) return { ok: true, noop: true };
  const known = m.states.includes(cur);
  const candidates = m.moves.filter(mv => mv.to === to && mv.event === event && (known ? fromOk(mv.from, cur) : true));
  if (!candidates.length) {
    const label = known ? m.labels[cur] : (cur || 'none');
    const why = known && m.final.includes(cur)
      ? `${m.name} is ${label}, which is final`
      : `${m.name} cannot go from ${label} to ${m.labels[to]} this way`;
    return { ok: false, reason: `${why}.`, allowed: known ? movesFrom(m, cur, ctx) : [] };
  }
  let refusal: string | null = null;
  for (const mv of candidates) {
    const r = mv.guard ? mv.guard(ctx) : null;
    if (r === null) return { ok: true, noop: false, move: { event: mv.event } };
    refusal ??= r;
  }
  return { ok: false, reason: refusal!, allowed: known ? movesFrom(m, cur, ctx) : [] };
}

/** An error a write throws when a move is refused; routes answer it as 409 with the reason and what is allowed instead. */
export class MoveRefused extends Error {
  readonly status = 409;
  constructor(readonly machine: string, readonly from: string, readonly to: string, readonly allowed: { to: string; event: string }[], reason: string) {
    super(reason);
    this.name = 'MoveRefused';
  }
}

/** check() that throws MoveRefused; returns whether the move writes anything. */
export function assertMove<S extends string, C>(m: Machine<S, C>, from: string | null | undefined, to: S, event: string, ctx: C): { noop: boolean } {
  const v = check(m, from, to, event, ctx);
  if (!v.ok) throw new MoveRefused(m.name, String(from ?? ''), to, v.allowed, v.reason);
  return { noop: v.noop };
}
