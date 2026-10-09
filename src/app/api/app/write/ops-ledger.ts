/**
 * Expenses and Extra revenue, native on the phone: an expense edited or deleted (the expense form's Save
 * on a row, and Delete), and extra revenue added, edited or deleted (the revenue page's form and Delete).
 * Each runs lib/writes/expense-admin.ts, the copy the store can take up, on the Admin SDK. Adding an
 * expense is addExpense in route.ts.
 *
 * Owners only: these pages are the owners' (the shop floor never sees the expenses), and in the browser
 * the writes are direct Firestore writes.
 *
 * The forms' own rules check the body (expenseFieldsFrom, revenueFieldsFrom): only their fields are read,
 * and a field of the wrong shape is refused rather than guessed at. A row that is another page's (a
 * partner's drawing, money taken on a repair) is refused with that page's name, before the delete code is
 * asked for, so no try is spent on it; as is a row already gone. Every delete asks for the code (decision
 * "Delete code"), checked here before anything is touched, with the store's own words for what is deleted.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import {
  LedgerRowRefusal, addExtraRevenue, deleteExpense, deleteExtraRevenue, drawingEntryOf, drawingRefusal, expenseFieldsFrom,
  repairRefusal, revenueFieldsFrom, updateExpense, updateExtraRevenue,
} from '@/lib/writes/expense-admin';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const LEDGER_OPS: OpRoles = {
  updateExpense: ['owner'],
  deleteExpense: ['owner'],
  addExtraRevenue: ['owner'],
  updateExtraRevenue: ['owner'],
  deleteExtraRevenue: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** A row gone ("No such …") or another page's: a refusal, not a crash. */
const refused = (e: unknown) =>
  e instanceof LedgerRowRefusal || (e instanceof Error && /^No such /.test(e.message)) ? bad((e as Error).message, 409) : null;

export const runLedgerOp: OpHandler = async (op, body, ctx) => {
  const fx = { log: ctx.log };
  const attempt = async (write: () => Promise<Record<string, unknown>>) => {
    try {
      return NextResponse.json({ ok: true, ...(await write()), followUps: ctx.followUps });
    } catch (e) {
      const no = refused(e);
      if (no) return no;
      throw e;
    }
  };

  switch (op) {
    case 'updateExpense': {
      const expenseId = idOf(body.expenseId);
      if (!expenseId) return bad('Which expense?');
      const cleaned = expenseFieldsFrom(body);
      if (!cleaned.ok) return bad(cleaned.error);
      return attempt(async () => ({ expense: await updateExpense(adminPort, expenseId, cleaned.value, fx) }));
    }

    case 'deleteExpense': {
      const expenseId = idOf(body.expenseId);
      if (!expenseId) return bad('Which expense?');
      const expense = await adminPort.get<{ description?: string; category?: string }>('expenses', expenseId);
      if (!expense) return bad('No such expense.', 409);
      const drawing = await drawingEntryOf(adminPort, expense);
      if (drawing) return bad(drawingRefusal(drawing.name, 'delete').message, 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, `Delete expense "${expense.description || expenseId}"`);
      if (!code.ok) return bad(code.error, code.status);
      return attempt(async () => deleteExpense(adminPort, expenseId, fx));
    }

    case 'addExtraRevenue': {
      const cleaned = revenueFieldsFrom(body);
      if (!cleaned.ok) return bad(cleaned.error);
      return attempt(async () => ({ revenue: await addExtraRevenue(adminPort, cleaned.value, fx) }));
    }

    case 'updateExtraRevenue': {
      const revenueId = idOf(body.revenueId);
      if (!revenueId) return bad('Which entry?');
      const cleaned = revenueFieldsFrom(body);
      if (!cleaned.ok) return bad(cleaned.error);
      return attempt(async () => ({ revenue: await updateExtraRevenue(adminPort, revenueId, cleaned.value, fx) }));
    }

    case 'deleteExtraRevenue': {
      const revenueId = idOf(body.revenueId);
      if (!revenueId) return bad('Which entry?');
      const row = await adminPort.get<{ repairId?: string }>('additional_revenue', revenueId);
      if (!row) return bad('No such revenue entry.', 409);
      if (row.repairId) return bad(repairRefusal().message, 409);
      const code = await passDeleteCode(ctx.email, body.deleteCode, 'Delete this extra revenue');
      if (!code.ok) return bad(code.error, code.status);
      return attempt(async () => deleteExtraRevenue(adminPort, revenueId, fx));
    }
  }
  return null;
};
