/**
 * The workshop operations of the app's write route, native on the phone: a karigar's pay batches and silver
 * and removing him (src/app/karigars/[id]/page.tsx), stock work assigned, changed and deleted and a sold
 * piece's bench work (src/app/workshop/page.tsx), and a given item edited or deleted (src/app/given/page.tsx).
 * Each runs lib/writes/workshop-admin.ts on the Admin SDK, the copy the browser's store can take up.
 *
 * Owners only: in the browser these are direct Firestore writes, and the shop floor has no Firestore access.
 * Paying him is not here: it is an expense, sent as addExpense with his id and his open batch's.
 *
 * Every delete asks for the delete code, as the store's delete actions do (decision "Delete code"), checked
 * here before anything is touched, under the store's own words. Removing a karigar asks too: the store asks
 * for it, though it only hides him. Bodies are checked strictly: only the fields named are read, a field of
 * the wrong shape is refused rather than guessed at, and a record that is not on file is refused (409).
 */

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { staticCategories } from '@/lib/categories';
import {
  addSilverEntry, addStockJob, deleteGivenItem, deletePayBatch, deleteSilverEntry, deleteStockJob, removeKarigar,
  setInvoicePieceDone, setInvoicePieceGiven, setInvoicePieceKarigar, setStockJobGiven, setStockJobStatus, settlePayBatch,
  startPayBatch, STOCK_JOB_METALS, STOCK_JOB_STATUSES, updateGivenItem, updateStockJobDetails, WorkshopRefusal,
  type GivenEdit, type StockJobDetails, type StockJobMetal, type StockJobStatus,
} from '@/lib/writes/workshop-admin';
import type { OpHandler, OpRoles } from './op-context';
import { STORE_TAKEN_BY } from '@/lib/store-config';

/** Who may run each operation: as the browser allows it today. */
export const WORKSHOP_OPS: OpRoles = {
  startPayBatch: ['owner'],
  settlePayBatch: ['owner'],
  deletePayBatch: ['owner'],
  addSilverEntry: ['owner'],
  deleteSilverEntry: ['owner'],
  removeKarigar: ['owner'],
  addStockJob: ['owner'],
  setStockJobStatus: ['owner'],
  setStockJobGiven: ['owner'],
  updateStockJobDetails: ['owner'],
  deleteStockJob: ['owner'],
  setInvoicePieceKarigar: ['owner'],
  setInvoicePieceDone: ['owner'],
  setInvoicePieceGiven: ['owner'],
  updateGivenItem: ['owner'],
  deleteGivenItem: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A Firestore document id as one path piece: text, no slash, and not absurd. */
const idOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

/** Text of at most `max` letters, trimmed; null when it is not text or too long. A missing field is empty. */
const textOf = (v: unknown, max: number): string | null => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length <= max ? s : null;
};

/** A figure of 0 or more; undefined when not sent; NaN when it is not one. */
const figureOf = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12 ? v : Number.NaN;
};

/** An ISO instant sent by the phone (a date picked), or null when it is not one. */
const instantOf = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const CATEGORY_IDS = new Set(staticCategories.map((c) => c.id));

/** A record that was refused (gone, settled, changed since) answers 409 with the shared write's words. */
const refused = (e: unknown) => (e instanceof WorkshopRefusal ? bad(e.message, 409) : null);

export const runWorkshopOp: OpHandler = async (op, body, ctx) => {
  const fx = { log: ctx.log };
  const deps = { deleteField: () => FieldValue.delete() };
  const now = new Date().toISOString();
  const ok = (out: Record<string, unknown>) => NextResponse.json({ ok: true, ...out, followUps: ctx.followUps });
  /** The code first (a gone record is said before it, so no try is spent on it), then the delete. */
  const gate = async (what: string) => {
    const code = await passDeleteCode(ctx.email, body.deleteCode, what);
    return code.ok ? null : bad(code.error, code.status);
  };

  try {
    switch (op) {
      // ── Pay batches ──
      case 'startPayBatch': {
        const karigarId = idOf(body.karigarId);
        const label = textOf(body.label, 120);
        if (!karigarId) return bad('A karigar is needed.');
        if (!label) return bad('Give the pay batch a name.');
        return ok({ batch: await startPayBatch(adminPort, { karigarId, label, startDate: now }, fx) });
      }

      case 'settlePayBatch': {
        const batchId = idOf(body.batchId);
        if (!batchId) return bad('Which pay batch?');
        const expectedTotal = figureOf(body.expectedTotal);
        if (Number.isNaN(expectedTotal)) return bad('The total shown must be a figure of 0 or more.');
        const carryOverLabel = textOf(body.carryOverLabel, 120);
        if (carryOverLabel === null) return bad('The new pay batch\'s name is text of up to 120 letters.');
        const out = await settlePayBatch(adminPort, { batchId, closedDate: now, expectedTotal, carryOverLabel }, fx);
        return ok(out);
      }

      case 'deletePayBatch': {
        const batchId = idOf(body.batchId);
        if (!batchId) return bad('Which pay batch?');
        if (!(await adminPort.get('karigar_batches', batchId))) return bad('No such pay batch.', 409);
        const no = await gate('Delete this karigar batch');
        if (no) return no;
        return ok(await deletePayBatch(adminPort, { batchId }, fx));
      }

      // ── Silver ──
      case 'addSilverEntry': {
        const karigarId = idOf(body.karigarId);
        if (!karigarId) return bad('A karigar is needed.');
        const silverGrams = body.silverGrams;
        const surchargePerGram = body.surchargePerGram ?? 0;
        if (typeof silverGrams !== 'number' || typeof surchargePerGram !== 'number') return bad('The grams and the surcharge are figures.');
        const description = textOf(body.description, 500);
        if (description === null) return bad('The note is text of up to 500 letters.');
        const entry = await addSilverEntry(adminPort, { karigarId, date: now, silverGrams, surchargePerGram, description }, fx);
        return ok({ entry });
      }

      case 'deleteSilverEntry': {
        const id = idOf(body.id);
        if (!id) return bad('Which silver entry?');
        if (!(await adminPort.get('silver_transactions', id))) return bad('No such silver entry.', 409);
        const no = await gate('Delete this silver entry');
        if (no) return no;
        return ok(await deleteSilverEntry(adminPort, { id }, fx));
      }

      // ── Removing a karigar ──
      case 'removeKarigar': {
        const karigarId = idOf(body.karigarId);
        if (!karigarId) return bad('A karigar is needed.');
        const held = await adminPort.get<{ name?: string; deletedAt?: string }>('karigars', karigarId);
        if (!held || held.deletedAt) return bad('No such karigar.', 409);
        const no = await gate(`Delete karigar ${held.name || karigarId}`);
        if (no) return no;
        return ok(await removeKarigar(adminPort, { karigarId, at: now }, fx));
      }

      // ── Stock work ──
      case 'addStockJob': {
        const raw = (body.job && typeof body.job === 'object' && !Array.isArray(body.job) ? body.job : {}) as Record<string, unknown>;
        const karigarId = idOf(raw.karigarId);
        const description = textOf(raw.description, 300);
        if (!karigarId || !description) return bad('Select a karigar and describe the work.');
        const itemCategory = textOf(raw.itemCategory, 20);
        if (itemCategory === null || (itemCategory && !CATEGORY_IDS.has(itemCategory))) return bad('Choose a category from the list.');
        const metal = raw.metalType === undefined || raw.metalType === null ? 'gold' : raw.metalType;
        if (!(STOCK_JOB_METALS as readonly unknown[]).includes(metal)) return bad('Gold, silver, platinum or palladium.');
        const weightG = figureOf(raw.weightG);
        const quantity = figureOf(raw.quantity);
        const agreedCost = figureOf(raw.agreedCost);
        if ([weightG, quantity, agreedCost].some((n) => Number.isNaN(n))) return bad('Weight, quantity and making must be figures of 0 or more.');
        const size = textOf(raw.size, 60);
        const notes = textOf(raw.notes, 2000);
        if (size === null || notes === null) return bad('Size and notes are text.');
        const job = await addStockJob(adminPort, {
          karigarId, description, assignedDate: now,
          itemCategory: itemCategory || undefined, metalType: metal as StockJobMetal,
          weightG, quantity, agreedCost, size, notes,
        }, fx);
        return ok({ job });
      }

      case 'setStockJobStatus': {
        const jobId = idOf(body.jobId);
        const status = body.status as StockJobStatus;
        if (!jobId || !(STOCK_JOB_STATUSES as readonly unknown[]).includes(status)) return bad('Bad request');
        return ok(await setStockJobStatus(adminPort, { jobId, status, at: now }, fx));
      }

      case 'setStockJobGiven': {
        const jobId = idOf(body.jobId);
        if (!jobId || typeof body.given !== 'boolean') return bad('Bad request');
        const givenAt = body.given ? (instantOf(body.givenAt) ?? now) : null;
        return ok(await setStockJobGiven(adminPort, { jobId, givenAt }, deps));
      }

      case 'updateStockJobDetails': {
        const jobId = idOf(body.jobId);
        const raw = body.patch;
        if (!jobId || !raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('Bad request');
        const sent = raw as Record<string, unknown>;
        const patch: StockJobDetails = {};
        if ('description' in sent) {
          const d = textOf(sent.description, 300);
          if (!d) return bad('An item needs a name.');
          patch.description = d;
        }
        for (const key of ['size', 'notes'] as const) {
          if (!(key in sent)) continue;
          const t = textOf(sent[key], key === 'size' ? 60 : 2000);
          if (t === null) return bad('Size and instructions are text.');
          patch[key] = t;
        }
        if ('weightG' in sent) {
          const w = figureOf(sent.weightG);
          if (w === undefined || Number.isNaN(w)) return bad('Weight must be a figure of 0 or more.');
          patch.weightG = w;
        }
        return ok(await updateStockJobDetails(adminPort, { jobId, patch }, deps, fx));
      }

      case 'deleteStockJob': {
        const jobId = idOf(body.jobId);
        if (!jobId) return bad('Which job?');
        if (!(await adminPort.get('karigar_jobs', jobId))) return bad('No such job.', 409);
        const no = await gate('Delete this karigar job');
        if (no) return no;
        return ok(await deleteStockJob(adminPort, { jobId }, fx));
      }

      // ── A sold piece on the bench ──
      case 'setInvoicePieceKarigar':
      case 'setInvoicePieceDone':
      case 'setInvoicePieceGiven': {
        const invoiceId = idOf(body.invoiceId);
        const index = body.index;
        if (!invoiceId || typeof index !== 'number' || !Number.isInteger(index)) return bad('Bad request');
        if (op === 'setInvoicePieceKarigar') {
          const karigarId = body.karigarId === null || body.karigarId === undefined ? null : idOf(body.karigarId);
          if (karigarId === '') return bad('Which karigar?');
          return ok(await setInvoicePieceKarigar(adminPort, { invoiceId, index, karigarId }, fx));
        }
        if (op === 'setInvoicePieceDone') {
          if (typeof body.done !== 'boolean') return bad('Bad request');
          return ok(await setInvoicePieceDone(adminPort, { invoiceId, index, done: body.done }));
        }
        if (typeof body.given !== 'boolean') return bad('Bad request');
        const givenAt = body.given ? (instantOf(body.givenAt) ?? now) : null;
        return ok(await setInvoicePieceGiven(adminPort, { invoiceId, index, givenAt }));
      }

      // ── Given items ──
      case 'updateGivenItem': {
        const id = idOf(body.id);
        const raw = body.item;
        if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('Bad request');
        const sent = raw as Record<string, unknown>;
        const date = instantOf(sent.date);
        if (!date) return bad('Date is required.');
        const description = textOf(sent.description, 300);
        if (!description) return bad('Description is required.');
        const recipientType = sent.recipientType;
        if (recipientType !== 'karigar' && recipientType !== 'customer' && recipientType !== 'other') return bad('Karigar, customer or other.');
        const recipientName = textOf(sent.recipientName, 200);
        if (!recipientName) return bad('Recipient name is required.');
        const notes = textOf(sent.notes, 1000);
        if (notes === null) return bad('Notes are text.');
        // Linked only to a karigar or a customer; an id that is not one is a link cleared.
        const recipientId = recipientType === 'other' ? '' : idOf(sent.recipientId);
        // Given by: one of the shop's names, or cleared; an app that never sends it leaves it alone.
        let givenBy: string | null | undefined;
        if ('givenBy' in sent) {
          const g = sent.givenBy;
          if (g === null || g === '') givenBy = null;
          else if (typeof g === 'string' && STORE_TAKEN_BY.includes(g.trim())) givenBy = g.trim();
          else return bad('Given by is not one of the shop’s people.');
        }
        const edit: GivenEdit = { date, description, recipientType, recipientName, notes, ...(recipientId && { recipientId }), ...(givenBy !== undefined && { givenBy }) };
        return ok(await updateGivenItem(adminPort, { id, edit }, deps, fx));
      }

      case 'deleteGivenItem': {
        const id = idOf(body.id);
        if (!id) return bad('Which item?');
        const held = await adminPort.get<{ description?: string }>('given_items', id);
        if (!held) return bad('No such given item.', 409);
        const no = await gate(`Delete given item "${held.description || id}"`);
        if (no) return no;
        return ok(await deleteGivenItem(adminPort, { id }, fx));
      }
    }
  } catch (e) {
    const no = refused(e);
    if (no) return no;
    throw e;
  }
  return null;
};
