/**
 * Settings → Import contacts, the part after the plan (triage.ts): what pressing Import does with the
 * shop's choices, and the writes it makes. The one copy of the page's `runImport`
 * (src/app/settings/contact-import), for the iPhone app (/api/app/write `importContacts`, ops-settings2.ts),
 * which the page can run too.
 *
 * In the page's order: every new contact not dropped is added, then each half-match as the shop answered it.
 * "Same person, second phone" puts the number in the spare slot (never over the number already there);
 * "Same person, fuller name" renames; "Different people" adds this one separately; "Leave the book alone",
 * or no answer, changes nothing. A contact is added as the store adds one (new-customer.ts, people.ts
 * `addKarigar`), so what the store drops is dropped here too.
 *
 * The phone reads the plan first and then asks for the import; the server makes the plan again from the same
 * file and the books as they are then. `planFingerprint` is how it knows the two are the same plan: a name
 * renamed or a customer added meanwhile changes it, and the import is refused rather than run against
 * choices made about something else.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { addKarigar, updateCustomer, updateKarigar } from '@/lib/writes/people';
import { addCustomerDoc } from '@/lib/writes/new-customer';
import type { ConflictChoice, ConflictReason, ExistingRow, ImportPlan, PendingContact } from './triage';

export type ContactImportStep =
  | { kind: 'create'; contact: PendingContact }
  | { kind: 'addPhone'; target: ExistingRow; phone: string }
  | { kind: 'adoptName'; target: ExistingRow; name: string };

/** The answers each kind of half-match offers (the page's ConflictRow). */
export const CHOICES_FOR: Record<ConflictReason, readonly ConflictChoice[]> = {
  same_name: ['add_phone', 'add_separately', 'skip'],
  same_phone: ['adopt_name', 'add_separately', 'skip'],
};

/** What Import does, step by step, for the contacts not dropped and the answers given. */
export function contactImportSteps(
  plan: ImportPlan,
  dropped: Iterable<string>,
  choices: Record<string, ConflictChoice | undefined>,
): ContactImportStep[] {
  const off = new Set(dropped);
  const steps: ContactImportStep[] = [];
  for (const f of plan.fresh) if (!off.has(f.id)) steps.push({ kind: 'create', contact: f });
  for (const c of plan.conflicts) {
    const choice = choices[c.id];
    if (!choice || choice === 'skip') continue;
    if (choice === 'add_separately') {
      steps.push({ kind: 'create', contact: c });
      continue;
    }
    const target = c.matches[0];
    // The spare slot only. The number already in the book keeps its place.
    if (choice === 'add_phone' && c.phone) steps.push({ kind: 'addPhone', target, phone: c.phone });
    else if (choice === 'adopt_name') steps.push({ kind: 'adoptName', target, name: c.name });
  }
  return steps;
}

/** The answers checked against the plan: each one is for a half-match in it, and one that half-match offers. */
export function checkChoices(plan: ImportPlan, choices: unknown): { ok: true; choices: Record<string, ConflictChoice> } | { ok: false; error: string } {
  if (choices === undefined || choices === null) return { ok: true, choices: {} };
  if (typeof choices !== 'object' || Array.isArray(choices)) return { ok: false, error: 'The answers are one per half-match.' };
  const out: Record<string, ConflictChoice> = {};
  for (const [id, v] of Object.entries(choices as Record<string, unknown>)) {
    const c = plan.conflicts.find((x) => x.id === id);
    if (!c) return { ok: false, error: 'An answer is for a contact that is not a half-match in this file.' };
    if (!(CHOICES_FOR[c.reason] as readonly unknown[]).includes(v)) return { ok: false, error: `“${c.name}” cannot be answered that way.` };
    out[id] = v as ConflictChoice;
  }
  return { ok: true, choices: out };
}

/** Two 32-bit FNV-1a hashes of the text, as 16 hex digits: enough to tell one plan from another. */
function fnv(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193);
    b = Math.imul(b ^ ch, 0x01000193) ^ (b >>> 13);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** The plan as the shop saw it: who is new, who half-matches whom, how many were settled. */
export function planFingerprint(plan: ImportPlan): string {
  const row = (r: ExistingRow) => [r.kind, r.id, r.name, r.phone ?? '', r.altPhone ?? ''].join(':');
  const lines = [
    ...plan.fresh.map((f) => ['f', f.id, f.kind, f.name, f.phone ?? '', f.extraPhones.join(','), f.tags.join(',')].join('|')),
    ...plan.conflicts.map((c) => ['c', c.id, c.kind, c.reason, c.name, c.phone ?? '', c.extraPhones.join(','), c.matches.map(row).join(',')].join('|')),
    `s|${plan.settled.length}`,
  ];
  return fnv(lines.join('\n'));
}

export type ContactImportResult = { added: number; updated: number };

/**
 * The steps written, each as the store writes it. `newCustomerId` names each new customer (customerIdMaker);
 * `db` may be a gathered port (gathered.ts), which sends them all in a few batches.
 */
export async function runContactImport(
  db: DbPort,
  steps: ContactImportStep[],
  opts: { newCustomerId: () => string },
  fx: SideEffects = {},
): Promise<ContactImportResult> {
  let added = 0;
  let updated = 0;
  for (const s of steps) {
    if (s.kind === 'create') {
      const c = s.contact;
      if (c.kind === 'karigar') {
        await addKarigar(db, { name: c.name, contact: c.phone ?? undefined, altPhone: c.extraPhones[0] } as Parameters<typeof addKarigar>[1], fx);
      } else {
        // The page hands over the spare number and the tags as well; the store keeps neither (new-customer.ts).
        await addCustomerDoc(db, { name: c.name, phone: c.phone ?? undefined }, opts.newCustomerId(), fx);
      }
      added++;
    } else if (s.kind === 'addPhone') {
      if (s.target.kind === 'customer') await updateCustomer(db, s.target.id, { altPhone: s.phone }, fx);
      else await updateKarigar(db, s.target.id, { altPhone: s.phone }, fx);
      updated++;
    } else {
      if (s.target.kind === 'customer') await updateCustomer(db, s.target.id, { name: s.name }, fx);
      else await updateKarigar(db, s.target.id, { name: s.name }, fx);
      updated++;
    }
  }
  return { added, updated };
}
