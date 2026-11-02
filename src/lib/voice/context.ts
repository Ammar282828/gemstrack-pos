/**
 * What the person is looking at while they talk (owner, 2026-11-02: "smart enough to know what im referring to").
 *
 * The phone says which record is open on its screen (`context` in the /api/voice/native body: its kind and id,
 * a short label, and for an order or invoice its pieces). Only the kind and id are trusted: the record is read
 * from the server's own book and described from there, so a stale label on the phone cannot put a wrong figure
 * in front of the model. The phone's label and pieces are used only when the book has no such row (a record
 * made seconds ago). The description is told to the model as section 8 of its prompt (prompt.ts), so "change
 * the weight to 12 grams", "add 5000 advance" or "call her" land on this record without its name being said.
 */

import type { Book } from './args';
import { editFieldLines, EDIT_KINDS } from './record-edit';

export const CONTEXT_KINDS = [...EDIT_KINDS, 'expense'] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export interface VoiceContext {
  kind: ContextKind;
  id: string;
  /** The phone's own line ("Order ORD-0123 · Ayesha · 2 pieces"), shown only when the book has no row. */
  label: string;
  pieces: { index: number; name: string }[];
  /** The one piece open (the Workshop's Details sheet), from 0: what "it" is. */
  piece?: number;
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');

/** The context from a request body, or null when it is absent or not usable (the sentence then stands alone). */
export function contextFrom(value: unknown): VoiceContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const kind = clip(v.kind, 20) as ContextKind;
  const id = clip(v.id, 200);
  if (!(CONTEXT_KINDS as readonly string[]).includes(kind) || !id || id.includes('/')) return null;
  const pieces = (Array.isArray(v.pieces) ? v.pieces : []).slice(0, 50).flatMap((p, n) => {
    if (!p || typeof p !== 'object') return [];
    const r = p as Record<string, unknown>;
    const index = typeof r.index === 'number' && Number.isInteger(r.index) && r.index >= 0 ? r.index : n;
    const name = clip(r.name, 120);
    return name ? [{ index, name }] : [];
  });
  const piece = typeof v.piece === 'number' && Number.isInteger(v.piece) && v.piece >= 0 && v.piece < 500 ? v.piece : undefined;
  return { kind, id, label: clip(v.label, 200), pieces, ...(piece !== undefined ? { piece } : {}) };
}

const rs = (n: unknown) => `Rs ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
const join = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ');
const day = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : '');

/** The record as the model is told it: one line for the record, one for each piece. Empty when it is unknown. */
export function contextLines(ctx: VoiceContext, book: Book): string[] {
  const lines = recordLines(ctx, book);
  // The Workshop's Details sheet is one piece of the record: "it" is that piece.
  if (lines.length && ctx.piece !== undefined) lines.push(`He has piece ${ctx.piece + 1} of it open: "it" is that piece.`);
  return lines;
}

function recordLines(ctx: VoiceContext, book: Book): string[] {
  const same = (a: unknown) => String(a ?? '').toLowerCase() === ctx.id.toLowerCase();
  const pieceLine = (i: number, parts: (string | false | null | undefined)[]) => `  piece ${i + 1}: ${join(parts)}`;
  switch (ctx.kind) {
    case 'order': {
      const o = book.orders.find(x => same(x.id));
      if (!o) break;
      return [
        `ORDER ${o.id} · for ${o.customerName || 'a walk-in'} · ${o.status}${o.promisedDate ? ` · due ${day(o.promisedDate)}` : ''}`
          + ` · advance ${rs(o.advancePayment)} · balance ${rs(o.grandTotal)}${o.invoiceId ? ` · invoiced as ${o.invoiceId}` : ''}`,
        ...(o.items ?? []).map((it, i) => pieceLine(i, [it.description || 'piece', it.karat, it.estimatedWeightG ? `${it.estimatedWeightG} g` : '',
          it.size && `size ${it.size}`, it.isCompleted && 'made'])),
      ];
    }
    case 'invoice': {
      const inv = book.invoices.find(x => same(x.id));
      if (!inv) break;
      return [
        `INVOICE ${inv.id} · for ${inv.customerName || 'a walk-in'} · total ${rs(inv.grandTotal)} · still owed ${rs(inv.balanceDue)}`,
        ...(inv.items ?? []).map((it, i) => pieceLine(i, [it.name || 'piece', it.karat, it.metalWeightG ? `${it.metalWeightG} g` : '', (it as { size?: string }).size && `size ${(it as { size?: string }).size}`])),
      ];
    }
    case 'customer': {
      const c = book.customers.find(x => same(x.id));
      if (!c) break;
      return [`CUSTOMER ${c.name} (id ${c.id})${c.phone ? ` · phone ${c.phone}` : ''}${c.ringSize ? ` · ring size ${c.ringSize}` : ''}`];
    }
    case 'karigar': {
      const k = book.karigars.find(x => same(x.id));
      if (!k) break;
      return [`KARIGAR ${k.name} (id ${k.id})${k.contact ? ` · phone ${k.contact}` : ''}`];
    }
    case 'product': {
      const p = book.products.find(x => same(x.sku));
      if (!p) break;
      return [`PIECE IN STOCK ${p.sku} · ${join([p.name || p.description, p.karat, p.metalWeightG ? `${p.metalWeightG} g` : '', p.size && `size ${p.size}`])}`];
    }
    case 'repair': {
      const r = book.repairs.find(x => same(x.id));
      if (!r) break;
      return [`REPAIR ${r.id} · for ${r.customerName} · ${r.status}${r.promisedDate ? ` · ready by ${day(r.promisedDate)}` : ''}`,
        ...(r.pieces ?? []).map((pc, i) => pieceLine(i, [pc.item, pc.work]))];
    }
    case 'job': {
      const j = book.karigarJobs.find(x => same(x.id));
      if (!j) break;
      return [`WORKSHOP JOB ${j.id} · ${join([j.description, j.karigarName && `with ${j.karigarName}`, j.status, j.size && `size ${j.size}`])}`];
    }
    case 'expense': {
      const e = book.expenses.find(x => same(x.id));
      if (!e) break;
      return [`EXPENSE ${e.id} · ${join([e.description, e.category, rs(e.amount), day(e.date)])}`];
    }
  }
  // Not in the server's book (made a moment ago): the phone's own words, no figures.
  if (!ctx.label) return [];
  return [`${ctx.kind.toUpperCase()} ${ctx.id} · ${ctx.label}`, ...ctx.pieces.map(p => `  piece ${p.index + 1}: ${p.name}`)];
}

/**
 * Section 8 of the prompt: the record, how "it" and "her" resolve to it, and the one-detail change. Empty when
 * nothing is open, so the prompt is exactly as before for the web and for a sentence said on a list.
 */
export function lookingSection(lines: string[]): string {
  if (!lines.length) return '';
  const head = lines[0];
  const kind = head.split(' ')[0].toLowerCase();
  return `=== 8. WHAT HE IS LOOKING AT ===

He has this open on his screen right now:
${lines.join('\n')}

When he does not name a record ("it", "this", "is ka", "uska", "her", "his", "the second piece", "change the
weight to 12"), he means THIS one: use it in the step by its number or name exactly as written above, and never
ask which. A different name or number said aloud wins over the screen. Piece numbers start at 1; with one piece,
"it" is that piece.

To change ONE detail of it (or of any record), use the edit command:
  edit | kind=<order|invoice|customer|karigar|product|repair|job> | id=<its number, SKU or name> | piece=<n> | field=<field> | value=<value>
Fields voice may change:
${editFieldLines().join('\n')}
Money is never an edit: an advance is order_advance, a payment invoice_payment, a discount order_discount.

  "change the weight to 12 grams"    -> edit | kind=order | id=<order> | piece=1 | field=weight | value=12
  "make it 22 karat"                 -> edit | kind=order | id=<order> | piece=1 | field=karat | value=22k
  "second piece size 7"              -> edit | kind=order | id=<order> | piece=2 | field=size | value=7
  "change the due date to Friday"    -> edit | kind=order | id=<order> | field=due date | value=<that Friday, YYYY-MM-DD>
  "add 5000 advance"                 -> order_advance | order=<order> | amount=5000
  "mark it ready"                    -> order_status | order=<order> | status=Completed   (a repair: repair_status | repair=<repair> | status=ready)
  "call her" / "WhatsApp her"        -> call | person=<the customer's name>
  "her phone is 0300 1234567"        -> edit | kind=customer | id=<the customer's name> | field=phone | value=03001234567
These are action "do". He is looking at a${/^[aeiou]/.test(kind) ? 'n' : ''} ${kind}: prefer the record above for every step.`;
}
