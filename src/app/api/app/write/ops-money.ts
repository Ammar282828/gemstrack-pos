/**
 * The owners' money pages, native on the phone: Overheads (the sheet saved from this month on),
 * Shareholders (a contribution, a withdrawal and its expense, deleting either, deleting a salary
 * payment, the working-capital floor) and Settings → Recently removed (putting people back, emptying
 * the list). Each runs a shared write (lib/writes/overheads.ts, shareholders.ts, recently-removed.ts)
 * on the Admin SDK, the copy the browser's page and store do the same with.
 *
 * Owners only: these pages are the owners' on the web, and the shop floor has no Firestore access.
 * A partner's salary is not here: it is an expense, sent as addExpense with the partner named.
 *
 * Every delete asks for the delete code, as the store's delete actions ask for it (decision "Delete
 * code"): it comes with the request and is checked here, with the same tries and logging as
 * /api/auth/delete-code, before anything is touched. Putting someone back is not a delete and does not
 * ask, as on the web. Bodies are checked strictly: only the fields named are read, and a field of the
 * wrong shape is refused rather than guessed at.
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { PARTNER_SALARY, type LedgerCategory } from '@/lib/partnership';
import { STORE_PARTNERSHIP } from '@/lib/store-config';
import type { OverheadItem } from '@/lib/overheads';
import { saveOverheadPlan } from '@/lib/writes/overheads';
import {
  addShareholderEntry, deletePartnerSalary, deleteShareholderEntry, saveWorkingCapitalFloor, shareholderOf,
} from '@/lib/writes/shareholders';
import { purgeRemoved, restoreRemoved } from '@/lib/writes/recently-removed';
import type { ShareholderId } from '@/lib/shareholders';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const MONEY_OPS: OpRoles = {
  saveOverheadPlan: ['owner'],
  addShareholderEntry: ['owner'],
  deleteShareholderEntry: ['owner'],
  deletePartnerSalary: ['owner'],
  setWorkingCapitalFloor: ['owner'],
  restoreRemoved: ['owner'],
  purgeRemoved: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** A list of ids; null when it is not one. A missing list is an empty one. */
const idsOf = (v: unknown): string[] | null => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 2000) return null;
  const ids = v.map(idOf);
  return ids.every(Boolean) ? ids : null;
};

/** The shared write says "No such …" for a record that is not on file: a refusal, not a crash. */
const missing = (e: unknown) => (e instanceof Error && /^No such /.test(e.message) ? bad(e.message, 409) : null);

/** The overhead sheet as the page edits it: an id, a name and a monthly amount per line. */
function sheetOf(v: unknown): { ok: true; items: OverheadItem[] } | { ok: false; error: string } {
  if (!Array.isArray(v) || v.length > 100) return { ok: false, error: 'The sheet is a list of up to 100 lines.' };
  const items: OverheadItem[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Each line is a name and an amount.' };
    const { id, label, amount } = raw as Record<string, unknown>;
    const key = typeof id === 'string' ? id.trim() : '';
    if (!key || key.length > 64 || key.includes('/') || seen.has(key)) return { ok: false, error: 'Each line needs its own id.' };
    if (typeof label !== 'string' || label.length > 120) return { ok: false, error: 'A line\'s name is text of up to 120 letters.' };
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e12) return { ok: false, error: 'A line\'s amount is a figure of 0 or more.' };
    seen.add(key);
    items.push({ id: key, label, amount });
  }
  return { ok: true, items };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const runMoneyOp: OpHandler = async (op, body, ctx) => {
  const fx = { log: ctx.log };
  // The partner books are one house's (STORE_PARTNERSHIP): the other has none to write.
  const partnersOnly = () => (STORE_PARTNERSHIP ? null : bad('This shop keeps no partner ledgers.', 403));

  switch (op) {
    case 'saveOverheadPlan': {
      const sheet = sheetOf(body.items);
      if (!sheet.ok) return bad(sheet.error);
      const out = await saveOverheadPlan(adminPort, { items: sheet.items }, fx);
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }

    case 'addShareholderEntry': {
      const refused = partnersOnly();
      if (refused) return refused;
      const person = shareholderOf(idOf(body.shareholderId));
      if (!person) return bad('Choose the shareholder.');
      const kind = body.kind;
      if (kind !== 'contribution' && kind !== 'withdrawal') return bad('A contribution or a withdrawal.');
      const category = body.category;
      if (category !== 'equity' && category !== 'loan') return bad('Equity or loan.');
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const amount = body.amount;
      if (!description || description.length > 300 || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
        return bad('Add a description and an amount');
      }
      const date = typeof body.date === 'string' ? body.date.trim() : '';
      if (!DAY.test(date) || Number.isNaN(new Date(date).getTime())) return bad('A date is needed.');
      const out = await addShareholderEntry(adminPort, {
        who: person.id as ShareholderId, kind, category: category as LedgerCategory, description, amount, date,
      }, fx);
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }

    case 'deleteShareholderEntry': {
      const refused = partnersOnly();
      if (refused) return refused;
      const person = shareholderOf(idOf(body.shareholderId));
      const entryId = idOf(body.entryId);
      if (!person || !entryId) return bad('Which entry?');
      // A gone entry is said before the code is asked for, so no try is spent on it.
      if (!(await adminPort.get(person.ledger, entryId))) return bad('No such ledger entry.', 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Delete this ${person.name} ledger entry`);
      if (!code.ok) return bad(code.error, code.status);
      try {
        const out = await deleteShareholderEntry(adminPort, { who: person.id as ShareholderId, entryId }, fx);
        return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
      } catch (e) {
        const gone = missing(e);
        if (gone) return gone;
        throw e;
      }
    }

    case 'deletePartnerSalary': {
      const refused = partnersOnly();
      if (refused) return refused;
      const expenseId = idOf(body.expenseId);
      if (!expenseId) return bad('Which salary payment?');
      const expense = await adminPort.get<{ category?: string; description?: string }>('expenses', expenseId);
      if (!expense) return bad('No such expense.', 409);
      if (expense.category !== PARTNER_SALARY) return bad('Not a partner salary.');
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Delete expense "${expense.description || expenseId}"`);
      if (!code.ok) return bad(code.error, code.status);
      try {
        const out = await deletePartnerSalary(adminPort, { expenseId }, fx);
        return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
      } catch (e) {
        const gone = missing(e);
        if (gone) return gone;
        throw e;
      }
    }

    case 'setWorkingCapitalFloor': {
      const refused = partnersOnly();
      if (refused) return refused;
      const value = body.value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) return bad('The floor is a figure of 0 or more.');
      // The page's floor names itself as set by "Shareholders" (working-capital-floor.tsx setBy).
      const settings = await saveWorkingCapitalFloor(adminPort, { value, by: 'Shareholders' }, fx);
      return NextResponse.json({ ok: true, settings, followUps: ctx.followUps });
    }

    case 'restoreRemoved': {
      const customerIds = idsOf(body.customerIds);
      const karigarIds = idsOf(body.karigarIds);
      if (!customerIds || !karigarIds) return bad('Name who to put back.');
      if (!customerIds.length && !karigarIds.length) return bad('Name who to put back.');
      const out = await restoreRemoved(adminPort, { customerIds, karigarIds }, { deleteField: () => FieldValue.delete() }, fx);
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }

    case 'purgeRemoved': {
      const customerIds = idsOf(body.customerIds);
      const karigarIds = idsOf(body.karigarIds);
      if (!customerIds || !karigarIds) return bad('Name who to delete.');
      if (!customerIds.length && !karigarIds.length) return bad('Nobody has been removed.');
      const code = await passDeleteCode(ctx.email, body.deleteCode, 'Delete every removed customer and karigar for good');
      if (!code.ok) return bad(code.error, code.status);
      const out = await purgeRemoved(adminPort, { customerIds, karigarIds }, fx);
      return NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
    }
  }
  return null;
};
