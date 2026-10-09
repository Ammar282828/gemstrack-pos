/**
 * The workshop's owner writes that the browser makes straight to Firestore (store.ts), as one copy the
 * iPhone app runs on the server (/api/app/write, ops-workshop.ts) and the store can take up:
 *
 *   a karigar's pay batches   start one, settle it (optionally starting the next), delete one
 *                             (store.ts createKarigarBatch, closeKarigarBatch, deleteKarigarBatch)
 *   his silver                an entry of silver received with its surcharge, and deleting one
 *                             (addSilverTransaction, deleteSilverTransaction)
 *   removing him              hidden, never deleted (deleteKarigar)
 *   stock work                a job written up by hand, its status, its handover, its making details,
 *                             deleting it (addKarigarJob, setKarigarJobStatus, setKarigarJobGiven,
 *                             updateKarigarJobDetails, deleteKarigarJob)
 *   a sold piece's bench work who has it, done, given (updateInvoiceItemKarigar, updateInvoiceItemStatus,
 *                             updateInvoiceItemGiven)
 *   given items               an entry edited or deleted (updateGivenItem, deleteGivenItem)
 *
 * Paying him is an expense (lib/writes/expenses.ts addExpense, filed under his open batch by `batchId`):
 * nothing here moves money. Settling a batch writes the total it comes to (lib/karigar-pay.ts
 * `batchTotal`), worked out here from the payments on file, and refuses when they no longer come to what
 * the owner was shown. None of these posts to Hisaab, as on the web (decision "One screen per question":
 * ticking "Given" posts nothing).
 *
 * The browser's merge-writes would make a document out of a patch for one that is gone; here a record that
 * is not on file is refused (`WorkshopRefusal`). The delete code is the caller's to check, before.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { batchTotal, batchPayments, isOpenBatch, silverProblem, silverSurcharge, type PayBatch, type PayExpense } from '@/lib/karigar-pay';
import { cleanObject } from './create-invoice';

const KARIGARS = 'karigars';
const BATCHES = 'karigar_batches';
const EXPENSES = 'expenses';
const SILVER = 'silver_transactions';
const JOBS = 'karigar_jobs';
const INVOICES = 'invoices';
const GIVEN = 'given_items';

/** store.ts KARIGAR_JOB_STATUSES (not imported: the store is the browser's). */
export const STOCK_JOB_STATUSES = ['pending', 'in-progress', 'completed'] as const;
export type StockJobStatus = typeof STOCK_JOB_STATUSES[number];
/** The Assign Stock Work form's metals (workshop/page.tsx). */
export const STOCK_JOB_METALS = ['gold', 'silver', 'platinum', 'palladium'] as const;
export type StockJobMetal = typeof STOCK_JOB_METALS[number];

/** A write refused because of what is on file (gone, already settled, changed since): the phone is told, nothing is written. */
export class WorkshopRefusal extends Error {}

function refuse(message: string): never {
  throw new WorkshopRefusal(message);
}

const log = (fx: SideEffects, a: string, t: string, d: string, id: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

/** "PKR 40,000", as the karigar page says a total. */
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-US')}`;

type KarigarDoc = { name?: string; deletedAt?: string };

/** A karigar on the books: on file and not removed. */
async function liveKarigar(db: DbPort, id: string): Promise<KarigarDoc & { id: string }> {
  const k = await db.get<KarigarDoc>(KARIGARS, id);
  if (!k || k.deletedAt) refuse('No such karigar.');
  return k as KarigarDoc & { id: string };
}

// ── Pay batches ─────────────────────────────────────────────────────────────

export type NewBatch = { id: string; karigarId: string; label: string; startDate: string };

/**
 * "Start a pay batch": named by the owner ("March 2026"), started now. The page offers it only while he has
 * no open batch, and a second open one is refused here too (a tap on two phones), so his payments have one
 * place to go.
 */
export async function startPayBatch(db: DbPort, input: { karigarId: string; label: string; startDate: string }, fx: SideEffects = {}): Promise<NewBatch> {
  const label = input.label.trim();
  if (!label) refuse('Give the pay batch a name.');
  const karigar = await liveKarigar(db, input.karigarId);
  const his = await db.queryEquals<PayBatch>(BATCHES, 'karigarId', input.karigarId);
  const open = his.find(isOpenBatch);
  if (open) refuse(`${karigar.name || 'He'} already has an open pay batch, "${open.label}". Settle it first.`);
  const id = db.newId(BATCHES);
  const batch = { karigarId: input.karigarId, label, startDate: input.startDate };
  const b = db.batch();
  b.set(BATCHES, id, batch);
  await b.commit();
  log(fx, 'karigar.update', `Pay batch started: ${label}`, `Karigar: ${karigar.name || input.karigarId}`, input.karigarId);
  return { id, ...batch };
}

/**
 * "Settle & Close" (and "Settle & Carry Over"): the batch is closed now with the total it comes to, and, when
 * a name is given for the next, a new batch starts at the same moment. Both in one commit. `expectedTotal`
 * is what the owner was shown: a payment added or removed since makes the total different, and the settle
 * is refused so he sees the new figure first.
 */
export async function settlePayBatch(
  db: DbPort,
  input: { batchId: string; closedDate: string; expectedTotal?: number; carryOverLabel?: string },
  fx: SideEffects = {},
): Promise<{ batchId: string; label: string; karigarId: string; totalPaid: number; closedDate: string; next: NewBatch | null }> {
  const batch = await db.get<PayBatch>(BATCHES, input.batchId);
  if (!batch) return refuse('No such pay batch.');
  if (!isOpenBatch(batch)) refuse(`"${batch.label}" is settled already.`);
  const filed = await db.queryEquals<PayExpense>(EXPENSES, 'batchId', batch.id);
  const totalPaid = batchTotal(batch, filed);
  if (input.expectedTotal !== undefined && Math.abs(totalPaid - input.expectedTotal) > 0.005) {
    refuse(`"${batch.label}" has changed since: it now comes to ${pkr(totalPaid)}. Check it and settle again.`);
  }
  const b = db.batch();
  b.set(BATCHES, batch.id, { closedDate: input.closedDate, totalPaid }, true);
  const carry = (input.carryOverLabel ?? '').trim();
  let next: NewBatch | null = null;
  if (carry) {
    next = { id: db.newId(BATCHES), karigarId: batch.karigarId, label: carry, startDate: input.closedDate };
    b.set(BATCHES, next.id, { karigarId: next.karigarId, label: next.label, startDate: next.startDate });
  }
  await b.commit();
  log(fx, 'karigar.update', `Pay batch settled: ${batch.label}`, `${pkr(totalPaid)}${next ? ` | Carried over to: ${next.label}` : ''}`, batch.karigarId);
  return { batchId: batch.id, label: batch.label, karigarId: batch.karigarId, totalPaid, closedDate: input.closedDate, next };
}

/**
 * "Delete Batch": the batch's own record only, as the store deletes it. Its payments stay in Expenses with
 * the batch's id on them, so they still count in what he has been paid, under no batch on his page.
 */
export async function deletePayBatch(db: DbPort, input: { batchId: string }, fx: SideEffects = {}): Promise<{ batchId: string; label: string; karigarId: string; payments: number }> {
  const batch = await db.get<PayBatch>(BATCHES, input.batchId);
  if (!batch) return refuse('No such pay batch.');
  const filed = batchPayments(batch, await db.queryEquals<PayExpense>(EXPENSES, 'batchId', batch.id));
  const b = db.batch();
  b.delete(BATCHES, batch.id);
  // Its payments stay in Expenses, unassigned (the web dialog's promise): a payment left pointing at a batch
  // that is gone was counted in his total paid but shown in no list.
  for (const p of filed) b.update(EXPENSES, p.id, { batchId: null });
  await b.commit();
  log(fx, 'karigar.update', `Pay batch deleted: ${batch.label}`, `${filed.length} payment${filed.length === 1 ? '' : 's'} left in Expenses, unassigned`, batch.karigarId);
  return { batchId: batch.id, label: batch.label, karigarId: batch.karigarId, payments: filed.length };
}

// ── Silver ──────────────────────────────────────────────────────────────────

export type SilverEntry = {
  id: string; karigarId: string; karigarName: string; date: string;
  silverGrams: number; surchargePerGram: number; totalSurcharge: number; description?: string;
};

/** "Silver Transaction": silver received from him, at a surcharge per gram; the total is the grams at that rate. */
export async function addSilverEntry(
  db: DbPort,
  input: { karigarId: string; date: string; silverGrams: number; surchargePerGram: number; description?: string },
  fx: SideEffects = {},
): Promise<SilverEntry> {
  const problem = silverProblem(input.silverGrams, input.surchargePerGram);
  if (problem) refuse(problem);
  const karigar = await liveKarigar(db, input.karigarId);
  const entry = cleanObject({
    karigarId: input.karigarId,
    karigarName: karigar.name || '',
    date: input.date,
    silverGrams: input.silverGrams,
    surchargePerGram: input.surchargePerGram,
    totalSurcharge: silverSurcharge(input.silverGrams, input.surchargePerGram),
    description: input.description?.trim() || undefined,
  });
  const id = db.newId(SILVER);
  const b = db.batch();
  b.set(SILVER, id, entry as unknown as Record<string, unknown>);
  await b.commit();
  log(fx, 'karigar.update', `Silver received: ${input.silverGrams.toFixed(3)}g`, `Karigar: ${entry.karigarName || input.karigarId} | Surcharge: ${pkr(entry.totalSurcharge)}`, input.karigarId);
  return { id, ...entry };
}

export async function deleteSilverEntry(db: DbPort, input: { id: string }, fx: SideEffects = {}): Promise<{ id: string }> {
  const entry = await db.get<Partial<SilverEntry>>(SILVER, input.id);
  if (!entry) return refuse('No such silver entry.');
  const b = db.batch();
  b.delete(SILVER, input.id);
  await b.commit();
  log(fx, 'karigar.update', `Silver entry deleted: ${(Number(entry.silverGrams) || 0).toFixed(3)}g`, `Karigar: ${entry.karigarName || entry.karigarId || '—'}`, entry.karigarId || input.id);
  return { id: input.id };
}

// ── Removing a karigar ──────────────────────────────────────────────────────

/** "Remove": he is hidden from the book (`deletedAt`); his hisaab and work stay, and Recently removed puts him back. */
export async function removeKarigar(db: DbPort, input: { karigarId: string; at: string }, fx: SideEffects = {}): Promise<{ karigarId: string; name: string }> {
  const karigar = await liveKarigar(db, input.karigarId);
  const b = db.batch();
  b.update(KARIGARS, input.karigarId, { deletedAt: input.at });
  await b.commit();
  const name = karigar.name || input.karigarId;
  log(fx, 'karigar.delete', `Removed karigar: ${name}`, `ID: ${input.karigarId}`, input.karigarId);
  return { karigarId: input.karigarId, name };
}

// ── Stock work (karigar_jobs) ───────────────────────────────────────────────

export type NewStockJob = {
  karigarId: string; description: string; assignedDate: string;
  itemCategory?: string; metalType?: StockJobMetal; weightG?: number; quantity?: number; size?: string;
  agreedCost?: number; notes?: string;
};

type JobDoc = { karigarId?: string; karigarName?: string; description?: string; status?: string };

/** "Assign Stock Work": a piece for the shop's own stock, a repair or a sample, Pending from now. */
export async function addStockJob(db: DbPort, input: NewStockJob, fx: SideEffects = {}): Promise<Record<string, unknown> & { id: string }> {
  const description = input.description.trim();
  if (!description) refuse('Select a karigar and describe the work.');
  const karigar = await liveKarigar(db, input.karigarId);
  const karigarName = karigar.name || 'Karigar';
  const job = cleanObject({
    karigarId: input.karigarId,
    karigarName,
    description,
    status: 'pending' as StockJobStatus,
    assignedDate: input.assignedDate,
    itemCategory: input.itemCategory || undefined,
    metalType: input.metalType || undefined,
    weightG: input.weightG,
    quantity: input.quantity,
    size: input.size?.trim() || undefined,
    agreedCost: input.agreedCost,
    notes: input.notes?.trim() || undefined,
  });
  const id = db.newId(JOBS);
  const b = db.batch();
  b.set(JOBS, id, job as Record<string, unknown>);
  await b.commit();
  log(fx, 'job.create', `Assigned job to ${karigarName}`, description, id);
  return { id, ...job };
}

/** The job's status; Completed stamps when (an earlier stamp is kept on a job put back, as the store keeps it). */
export async function setStockJobStatus(db: DbPort, input: { jobId: string; status: StockJobStatus; at: string }, fx: SideEffects = {}): Promise<{ jobId: string; status: StockJobStatus }> {
  const job = await db.runTransaction(async (tx) => {
    const held = await tx.get<JobDoc>(JOBS, input.jobId);
    if (!held) return refuse('No such job.');
    tx.update(JOBS, input.jobId, { status: input.status, ...(input.status === 'completed' && { completedDate: input.at }) });
    return held;
  });
  log(fx, 'job.update', `Job marked ${input.status}`, `${job.description || input.jobId} — ${job.karigarName || ''}`, input.jobId);
  return { jobId: input.jobId, status: input.status };
}

/** Handed over, or taken back: unticking removes the field (`deleteField`, the SDK's own), as the store does. */
export async function setStockJobGiven(db: DbPort, input: { jobId: string; givenAt: string | null }, deps: { deleteField: () => unknown }): Promise<{ jobId: string; givenAt: string | null }> {
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(JOBS, input.jobId))) refuse('No such job.');
    tx.update(JOBS, input.jobId, { givenAt: input.givenAt ?? deps.deleteField() });
  });
  return input;
}

export type StockJobDetails = { description?: string; size?: string; notes?: string; weightG?: number };

/**
 * "Making details" of a hand-made job: its name (never cleared), size, weight and instructions. A blank size or
 * instructions is removed, which a merge cannot do.
 */
export async function updateStockJobDetails(db: DbPort, input: { jobId: string; patch: StockJobDetails }, deps: { deleteField: () => unknown }, fx: SideEffects = {}): Promise<{ jobId: string; changed: string[] }> {
  const { patch } = input;
  const blankOr = (v?: string) => (v ?? '').trim() || deps.deleteField();
  const data: Record<string, unknown> = {};
  if (patch.description !== undefined && patch.description.trim()) data.description = patch.description.trim();
  if ('size' in patch) data.size = blankOr(patch.size);
  if ('notes' in patch) data.notes = blankOr(patch.notes);
  if (patch.weightG !== undefined) data.weightG = Number(patch.weightG) || 0;
  if (!Object.keys(data).length) refuse('Nothing to change.');
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(JOBS, input.jobId))) refuse('No such job.');
    tx.update(JOBS, input.jobId, data);
  });
  log(fx, 'job.update', 'Updated workshop job', `ID: ${input.jobId}`, input.jobId);
  return { jobId: input.jobId, changed: Object.keys(data) };
}

export async function deleteStockJob(db: DbPort, input: { jobId: string }, fx: SideEffects = {}): Promise<{ jobId: string; description: string }> {
  const job = await db.get<JobDoc>(JOBS, input.jobId);
  if (!job) return refuse('No such job.');
  const b = db.batch();
  b.delete(JOBS, input.jobId);
  await b.commit();
  log(fx, 'job.delete', `Deleted workshop job: ${job.description || input.jobId}`, `Karigar: ${job.karigarName || '—'}`, input.jobId);
  return { jobId: input.jobId, description: job.description || '' };
}

// ── A sold piece on the bench (an invoice's line) ───────────────────────────

type InvoicePiece = { name?: string; karigarId?: string; isCompleted?: boolean; givenAt?: string } & Record<string, unknown>;
type InvoiceDoc = { items?: InvoicePiece[] | Record<string, InvoicePiece> };

/**
 * The invoice's pieces with one changed, the list written back whole and merged over the invoice, as the
 * store writes it (a list kept as a map is written back as a list). Nothing priced is touched.
 */
async function changeInvoicePiece(db: DbPort, invoiceId: string, index: number, change: (p: InvoicePiece) => InvoicePiece): Promise<InvoicePiece> {
  return db.runTransaction(async (tx) => {
    const inv = await tx.get<InvoiceDoc>(INVOICES, invoiceId);
    if (!inv) return refuse(`No such invoice: ${invoiceId}.`);
    const items = (Array.isArray(inv.items) ? inv.items : Object.values(inv.items || {})) as InvoicePiece[];
    if (!Number.isInteger(index) || index < 0 || index >= items.length) refuse('That piece is not on this invoice any more.');
    const updated = items.map((item, i) => (i === index ? change({ ...item }) : item));
    tx.set(INVOICES, invoiceId, { items: updated }, true);
    return items[index];
  });
}

/** Who has a sold piece; "none" (or nothing) takes him off. */
export async function setInvoicePieceKarigar(db: DbPort, input: { invoiceId: string; index: number; karigarId: string | null }, fx: SideEffects = {}): Promise<{ invoiceId: string; index: number; karigarId: string | null }> {
  const clearing = !input.karigarId || input.karigarId === 'none';
  const karigar = clearing ? null : await liveKarigar(db, input.karigarId as string);
  const piece = await changeInvoicePiece(db, input.invoiceId, input.index, (p) => {
    if (clearing) delete p.karigarId; else p.karigarId = input.karigarId as string;
    return p;
  });
  const name = clearing ? 'Unassigned' : (karigar?.name || input.karigarId);
  log(fx, 'invoice.update', `Karigar assigned on ${input.invoiceId}`, `${piece.name || `Item ${input.index + 1}`} → ${name}`, input.invoiceId);
  return { invoiceId: input.invoiceId, index: input.index, karigarId: clearing ? null : input.karigarId };
}

/** A sold piece's bench work done (it leaves the Workshop), or not. */
export async function setInvoicePieceDone(db: DbPort, input: { invoiceId: string; index: number; done: boolean }): Promise<{ invoiceId: string; index: number; done: boolean }> {
  await changeInvoicePiece(db, input.invoiceId, input.index, (p) => ({ ...p, isCompleted: input.done }));
  return input;
}

/** A sold piece handed to its karigar, or taken back (the key goes, so "never given" and "taken back" read the same). */
export async function setInvoicePieceGiven(db: DbPort, input: { invoiceId: string; index: number; givenAt: string | null }): Promise<{ invoiceId: string; index: number; givenAt: string | null }> {
  await changeInvoicePiece(db, input.invoiceId, input.index, (p) => {
    if (input.givenAt) p.givenAt = input.givenAt; else delete p.givenAt;
    return p;
  });
  return input;
}

// ── Given items ─────────────────────────────────────────────────────────────

export type GivenEdit = {
  date: string; description: string; recipientType: 'karigar' | 'customer' | 'other'; recipientName: string;
  /** The linked karigar or customer; absent clears an old link (the name no longer resolves to one). */
  recipientId?: string;
  notes: string;
};

/** "Edit Given Item": its date, what it is, who has it and a note. Whether it came back is not changed here. */
export async function updateGivenItem(db: DbPort, input: { id: string; edit: GivenEdit }, deps: { deleteField: () => unknown }, fx: SideEffects = {}): Promise<{ id: string }> {
  const { edit } = input;
  const write: Record<string, unknown> = {
    date: edit.date,
    description: edit.description,
    recipientType: edit.recipientType,
    recipientName: edit.recipientName,
    recipientId: edit.recipientId ? edit.recipientId : deps.deleteField(),
    notes: edit.notes,
  };
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(GIVEN, input.id))) refuse('No such given item.');
    tx.update(GIVEN, input.id, write);
  });
  log(fx, 'given.update', 'Updated given item', `ID: ${input.id}`, input.id);
  return { id: input.id };
}

export async function deleteGivenItem(db: DbPort, input: { id: string }, fx: SideEffects = {}): Promise<{ id: string; description: string }> {
  const item = await db.get<{ description?: string }>(GIVEN, input.id);
  if (!item) return refuse('No such given item.');
  const b = db.batch();
  b.delete(GIVEN, input.id);
  await b.commit();
  const desc = item.description || input.id;
  log(fx, 'given.delete', `Deleted given item: ${desc}`, `ID: ${input.id}`, input.id);
  return { id: input.id, description: item.description || '' };
}
