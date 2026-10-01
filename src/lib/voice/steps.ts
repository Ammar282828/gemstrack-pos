/**
 * One sentence, several things done (owner, 2026-10-01: "voice should be able to do absolutely
 * anything"). "Rashida ka order complete karo, uska invoice banao aur 21k ka rate 34,000 kar do"
 * is three steps.
 *
 * A step is one of two kinds:
 *   classic   one of the khata's own entries (resolve.ts / apply.ts, with their rules), edited
 *             on the card exactly as a single spoken entry is (edit.ts);
 *   command   anything else, from the catalogue (commands.ts), its values read by args.ts.
 *
 * A later step can name what an earlier one made or found as "$1", "$2": "new customer Sara
 * … and an order for her" is a customer, then an order for "$1". Nothing runs until every step
 * is ready and the shop presses once; they then run in order, and one that fails stops the rest.
 */

import { COMMAND, type CommandDef, type Done, type Labels, type RunCtx, type Vals } from './commands';
import { resolveArg, type ArgSpec, type Book, type Choice, type Resolved } from './args';
import { READ_ONLY_ACTIONS, VOICE_ACTIONS, type RawIntent, type Reading, type VoiceAction } from './resolve';
import { newDraft, readDraft, type Draft } from './edit';
import { applyReading, type AppliedEntry } from './apply';
import { parseKarat, parseNumber } from './args';
import type { AppState } from '@/lib/store';

export interface RawStep { command?: string; args?: { name?: string; value?: string | number | null }[] | null }

/**
 * A step as the model writes it: one line, "set_rate | metal=21k | rate=34000". Kept flat on
 * purpose — asked for a list of objects inside a list, Gemini 2.5 Flash folded the whole list
 * into one string (2026-10-01); a line it writes every time.
 */
export function parseStepLine(line: string): RawStep {
  const [head, ...rest] = String(line).split('|').map(x => x.trim());
  return {
    command: head.replace(/[^a-z_]/gi, ''),
    args: rest.map(part => {
      const at = part.indexOf('=');
      return at < 0 ? { name: '', value: '' } : { name: part.slice(0, at).trim(), value: part.slice(at + 1).trim().replace(/^["']|["']$/g, '') };
    }),
  };
}

export type Step =
  | { kind: 'classic'; draft: Draft }
  | {
      kind: 'command'; command: string;
      args: Record<string, string>;
      pieces: Record<string, string>[];
      /** Answers chosen on the card, by arg name or `piece.<i>.<name>`. */
      pins: Record<string, Resolved>;
    };

/** Classic actions a step may be. The rest of VOICE_ACTIONS are questions, or the sentence itself. */
const CLASSIC_STEP = new Set<string>(VOICE_ACTIONS.filter(a => !['ask', 'query_balance', 'help', 'unknown', 'undo', 'do'].includes(a)));

/** The fields a classic step's args may set on a customer, a karigar, an order or a bill. */
const CLASSIC_FIELD = new Set(['method', 'status', 'date', 'note', 'name', 'phone', 'altPhone', 'email', 'city', 'address', 'country',
  'ringSize', 'bangleSize', 'braceletSize', 'chainLength', 'birthday', 'anniversary', 'preference', 'notes', 'contact', 'specialty', 'workshop']);

/** A classic action said as a step, as the model's single reply would have carried it. */
export function classicRaw(action: string, pairs: { name: string; value: string }[]): RawIntent {
  const get = (...names: string[]) => pairs.find(p => names.includes(p.name))?.value;
  const raw: RawIntent = { action, summary: '' };
  const who = get('person', 'customer', 'karigar', 'who');
  const doc = get('order', 'invoice', 'doc');
  if (who) raw.person = { spoken_as: who, name: who, ...(get('karigar') ? { kind: 'karigar' as const } : get('customer') ? { kind: 'customer' as const } : {}) };
  if (doc) {
    if (/\d/.test(doc)) raw.doc = { kind: action === 'invoice_payment' || action === 'open_invoice' ? 'invoice' : 'order', id: doc.replace(/\D+/g, '') };
    else if (!raw.person) raw.person = { spoken_as: doc, name: doc, kind: 'customer' };
  }
  const n = (v?: string) => (v == null ? null : parseNumber(v));
  if (get('amount')) raw.amount = n(get('amount'));
  if (get('grams', 'weight')) raw.grams = n(get('grams', 'weight'));
  if (get('karat')) raw.karat = Number(parseKarat(get('karat')!)?.replace('k', '')) || null;
  const desc = get('description', 'note', 'for');
  if (desc) raw.description = desc;
  if (get('category')) raw.category = get('category');
  if (get('screen')) raw.screen = get('screen');
  const fields: Record<string, string> = {};
  for (const p of pairs) if (CLASSIC_FIELD.has(p.name) && p.name !== 'note') fields[p.name] = p.value;
  if (Object.keys(fields).length) raw.fields = fields;
  return raw;
}

/** The model's steps, as the card holds them. Unknown commands are dropped and said so. */
export function stepsFrom(raw: (RawStep | string)[] | null | undefined): { steps: Step[]; dropped: string[] } {
  const steps: Step[] = [];
  const dropped: string[] = [];
  for (const one of raw ?? []) {
    const r = typeof one === 'string' ? parseStepLine(one) : one;
    const command = String(r.command ?? '').trim();
    const pairs = (r.args ?? []).map(a => ({ name: String(a?.name ?? '').trim(), value: String(a?.value ?? '').trim() })).filter(a => a.name && a.value);
    if (command === 'navigate') {
      steps.push({ kind: 'command', command: 'go', args: { screen: pairs.find(p => p.name === 'screen')?.value ?? '' }, pieces: [], pins: {} });
      continue;
    }
    if (CLASSIC_STEP.has(command)) {
      // A step's figures were said, not recovered from a sentence: read as edited, described here.
      steps.push({ kind: 'classic', draft: { ...newDraft(classicRaw(command, pairs)), edited: true } });
      continue;
    }
    const def = COMMAND.get(command);
    if (!def) { if (command) dropped.push(command); continue; }
    const args: Record<string, string> = {};
    const pieces: Record<string, string>[] = [];
    const own = new Set(def.args.map(a => a.name));
    const pieceFields = new Set(def.pieces?.fields.map(a => a.name) ?? []);
    for (const p of pairs) {
      if (def.pieces && p.name === def.pieces.start.name) pieces.push({ [p.name]: p.value });
      else if (def.pieces && pieceFields.has(p.name) && !own.has(p.name)) {
        if (!pieces.length) pieces.push({});
        pieces[pieces.length - 1][p.name] = p.value;
      } else if (own.has(p.name)) args[p.name] = p.value;
    }
    steps.push({ kind: 'command', command, args, pieces, pins: {} });
  }
  return { steps, dropped };
}

export interface ArgView { key: string; spec: ArgSpec; raw: string; r: Resolved | null }

export interface StepView {
  kind: 'classic' | 'command';
  def?: CommandDef;
  reading?: Reading;
  args: ArgView[];
  pieces: ArgView[][];
  ready: boolean;
  problem: string | null;
  summary: string;
  label: string;
  readOnly: boolean;
  danger: boolean;
  form: boolean;
}

export interface ViewCtx { book: Book; documents: Parameters<typeof readDraft>[1]['documents'] }

/** What a step will do, whether it can, and what still stands in the way. */
export function viewStep(step: Step, ctx: ViewCtx): StepView {
  if (step.kind === 'classic') {
    const reading = readDraft(step.draft, { roster: ctx.book.roster, aliases: ctx.book.aliases, documents: ctx.documents });
    const readOnly = READ_ONLY_ACTIONS.has(reading.action);
    return {
      kind: 'classic', reading, args: [], pieces: [], readOnly, danger: false, form: false,
      ready: readOnly ? !!reading.screen : reading.postable, problem: reading.blockedBecause, summary: reading.summary,
      label: reading.action.replace(/_/g, ' '),
    };
  }
  const def = COMMAND.get(step.command)!;
  const one = (spec: ArgSpec, raw: string | undefined, key: string): ArgView => ({ key, spec, raw: raw ?? '', r: step.pins[key] ?? resolveArg(spec, raw, ctx.book) });
  const args = def.args.map(a => one(a, step.args[a.name], a.name));
  const pieces = def.pieces ? step.pieces.map((p, i) => [def.pieces!.start, ...def.pieces!.fields].map(a => one(a, p[a.name], `piece.${i}.${a.name}`))) : [];
  const problems: string[] = [];
  for (const v of args) {
    if (v.r && !v.r.ok) problems.push(`${v.spec.label}: ${v.r.reason}`);
    else if (!v.r && v.spec.required) problems.push(`${v.spec.label}?`);
  }
  pieces.forEach((p, i) => {
    for (const v of p) if (v.r && !v.r.ok) problems.push(`Piece ${i + 1}, ${v.spec.label.toLowerCase()}: ${v.r.reason}`);
    // A piece needs something said about it: what it is, or which one from stock.
    if (!p.some(v => v.r)) problems.push(`Piece ${i + 1} is empty.`);
  });
  if (def.pieces && def.id !== 'new_sale' && def.id !== 'new_order' && !step.pieces.length) problems.push(`${def.pieces.start.label}?`);
  const L: Labels = Object.fromEntries(args.map(v => [v.spec.name, v.r?.ok ? v.r.label : v.raw || undefined]));
  L.pieces = pieces.map(p => Object.fromEntries(p.map(v => [v.spec.name, v.r?.ok ? v.r.label : v.raw || undefined])));
  return {
    kind: 'command', def, args, pieces, readOnly: !!def.readOnly, danger: !!def.danger, form: !!def.form,
    ready: problems.length === 0, problem: problems[0] ?? null, summary: def.describe(L), label: def.label,
  };
}

/** The values a command runs with: "$n" swapped for what step n made, rows read fresh from the store. */
function valuesFor(view: StepView, results: (Done | AppliedEntry)[], s: AppState): Vals {
  const fresh = (type: string, v: unknown): unknown => {
    const id = (v as { id?: string; sku?: string } | null)?.id;
    switch (type) {
      case 'order': return s.orders.find(o => o.id === id) ?? v;
      case 'invoice': return s.generatedInvoices.find(i => i.id === id) ?? v;
      case 'repair': return s.repairs.find(r => r.id === id) ?? v;
      case 'product': return s.products.find(p => p.sku === (v as { sku?: string })?.sku) ?? v;
      default: return v;
    }
  };
  const valueOf = (a: ArgView): unknown => {
    if (!a.r || !a.r.ok) return undefined;
    if (a.r.ref) {
      const made = results[a.r.ref - 1]?.made;
      if (!made) throw new Error(`Step ${a.r.ref} made nothing for "${a.spec.label}".`);
      return fresh(a.spec.type, made.value);
    }
    return fresh(a.spec.type, a.r.value);
  };
  const vals: Vals = {};
  for (const a of view.args) { const v = valueOf(a); if (v !== undefined) vals[a.spec.name] = v; }
  vals.pieces = view.pieces.map(p => Object.fromEntries(p.map(a => [a.spec.name, valueOf(a)]).filter(([, v]) => v !== undefined)));
  return vals;
}

export interface RunResult { done: (Done | AppliedEntry)[]; failedAt: number | null; error: string | null }

/**
 * Every step, in order. A failure stops the rest: the steps after it may depend on it, and a
 * half-done list is reported as exactly that, with what did go through able to be undone.
 */
export async function runSteps(steps: Step[], ctx: ViewCtx, x: RunCtx): Promise<RunResult> {
  const done: (Done | AppliedEntry)[] = [];
  for (let i = 0; i < steps.length; i++) {
    try {
      const view = viewStep(steps[i], ctx);
      if (!view.ready) throw new Error(view.problem ?? 'Not ready.');
      if (view.kind === 'classic') {
        const r = view.reading!;
        if (READ_ONLY_ACTIONS.has(r.action)) { if (r.screen) x.go(r.screen); done.push({ said: 'Opened.', href: r.screen ?? undefined }); continue; }
        const applied = await applyReading(r, x.s);
        // Who it was about, for a later "$n", when it made nobody new.
        done.push(applied.made || !r.person ? applied : { ...applied, made: { type: r.person.kind, value: { id: r.person.id, name: r.person.name, kind: r.person.kind } } });
      } else {
        done.push(await view.def!.run(valuesFor(view, done, x.s), x));
      }
    } catch (e) {
      return { done, failedAt: i, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { done, failedAt: null, error: null };
}

/** Every step that wrote something, taken back in reverse. */
export function undoAll(done: (Done | AppliedEntry)[]): (() => Promise<void>) | undefined {
  const undos = done.map(d => d.undo).filter((u): u is () => Promise<void> => !!u);
  if (!undos.length) return undefined;
  return async () => { for (const u of undos.reverse()) await u(); };
}

/** Changes to a command step from the card. */
export function setArg(step: Step, key: string, raw: string): Step {
  if (step.kind !== 'command') return step;
  const pins = { ...step.pins };
  delete pins[key];
  const m = key.match(/^piece\.(\d+)\.(.+)$/);
  if (m) {
    const pieces = step.pieces.map((p, i) => (i === Number(m[1]) ? { ...p, [m[2]]: raw } : p));
    return { ...step, pieces, pins };
  }
  return { ...step, args: { ...step.args, [key]: raw }, pins };
}

export function pickArg(step: Step, key: string, choice: Choice): Step {
  if (step.kind !== 'command') return step;
  return { ...step, pins: { ...step.pins, [key]: { ok: true, value: choice.value, label: choice.label } } };
}

export function addPiece(step: Step): Step {
  if (step.kind !== 'command') return step;
  return { ...step, pieces: [...step.pieces, {}] };
}

export function removePiece(step: Step, i: number): Step {
  if (step.kind !== 'command') return step;
  // Pins are keyed by position: the ones after the removed piece move up with it.
  const pins: Record<string, Resolved> = {};
  for (const [k, v] of Object.entries(step.pins)) {
    const m = k.match(/^piece\.(\d+)\.(.+)$/);
    if (!m) pins[k] = v;
    else if (Number(m[1]) < i) pins[k] = v;
    else if (Number(m[1]) > i) pins[`piece.${Number(m[1]) - 1}.${m[2]}`] = v;
  }
  return { ...step, pieces: step.pieces.filter((_, n) => n !== i), pins };
}

export type { VoiceAction };
