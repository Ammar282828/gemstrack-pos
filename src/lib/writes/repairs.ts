/**
 * Repair tickets: received, ready, collected, and the money taken on them. The one copy, run by the
 * browser (store.ts, the client SDK) and by the iPhone app (/api/app/write, the Admin SDK).
 *
 * Money taken on a ticket (an advance, the balance on collection) is written to Extra Revenue in the
 * same commit, so the dashboard and Analytics count it without knowing repairs exist.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Repair, RepairPayment } from '@/lib/store';
import { REPAIR_STATUS_LABELS, repairSummary, type RepairStatus } from '@/lib/repairs';
import { cleanObject } from './create-invoice';

const SETTINGS = 'app_settings';
const GLOBAL = 'global';
const REPAIRS = 'repairs';
const REVENUE = 'additional_revenue';

export type NewRepair = Omit<Repair, 'id' | 'payments' | 'status' | 'receivedAt'> & {
  receivedAt?: string;
  advance?: number;
  advanceMethod?: RepairPayment['method'];
};

const log = (fx: SideEffects, action: string, title: string, detail: string, id: string) =>
  void Promise.resolve(fx.log?.(action, title, detail, id)).catch(() => undefined);

/**
 * A new ticket, numbered REP-000001 on from the settings' counter. `floor`: the highest number this
 * device already holds, so a counter written before repairs existed can never issue one again.
 */
export async function addRepair(db: DbPort, input: NewRepair, opts: { floor?: number; now?: string } = {}, fx: SideEffects = {}): Promise<Repair> {
  const { advance, advanceMethod, ...data } = input;
  const now = opts.now ?? new Date().toISOString();
  const created = await db.runTransaction(async (tx) => {
    const settings = await tx.get<{ lastRepairNumber?: number }>(SETTINGS, GLOBAL);
    const next = Math.max(Number(settings?.lastRepairNumber) || 0, opts.floor || 0) + 1;
    const id = `REP-${String(next).padStart(6, '0')}`;
    if (await tx.get(REPAIRS, id)) throw new Error(`Repair ${id} already exists — the repair counter is behind. Try again.`);

    const payments: RepairPayment[] = [];
    if (advance && advance > 0) {
      const revenueId = db.newId(REVENUE);
      tx.set(REVENUE, revenueId, {
        date: now, amount: advance, repairId: id,
        description: `Repair ${id} — advance: ${repairSummary(data)} (${data.customerName || 'walk-in'})`,
      });
      payments.push({ amount: advance, date: now, ...(advanceMethod ? { method: advanceMethod } : {}), revenueId, note: 'Advance' });
    }
    const repair = cleanObject({ ...data, id, payments, status: 'received' as RepairStatus, receivedAt: data.receivedAt || now }) as Repair;
    tx.set(REPAIRS, id, repair as unknown as Record<string, unknown>);
    tx.update(SETTINGS, GLOBAL, { lastRepairNumber: next });
    return repair;
  });
  log(fx, 'repair.create', `Repair ${created.id} received: ${repairSummary(created)}`, `From: ${created.customerName || 'walk-in'}`, created.id);
  return created;
}

/** Ready and collected are stamped with when. */
export async function setRepairStatus(db: DbPort, id: string, status: RepairStatus, opts: { now?: string } = {}, fx: SideEffects = {}): Promise<void> {
  const now = opts.now ?? new Date().toISOString();
  const stamp = status === 'ready' ? { readyAt: now } : status === 'collected' ? { collectedAt: now } : {};
  const b = db.batch();
  b.set(REPAIRS, id, { status, ...stamp }, true);
  await b.commit();
  log(fx, 'repair.status', `Repair ${id}: ${REPAIR_STATUS_LABELS[status]}`, '', id);
}

/** Money taken on a ticket, and its Extra Revenue row, in one commit. */
export async function recordRepairPayment(db: DbPort, id: string, payment: RepairPayment, fx: SideEffects = {}): Promise<void> {
  if (!(payment.amount > 0)) return;
  await db.runTransaction(async (tx) => {
    const repair = await tx.get<Repair>(REPAIRS, id);
    if (!repair) throw new Error(`Repair ${id} not found.`);
    const revenueId = db.newId(REVENUE);
    tx.set(REVENUE, revenueId, {
      date: payment.date, amount: payment.amount, repairId: id,
      description: `Repair ${id}: ${repairSummary(repair)} (${repair.customerName || 'walk-in'})`,
    });
    tx.update(REPAIRS, id, { payments: [...(repair.payments || []), cleanObject({ ...payment, revenueId })] });
  });
  log(fx, 'repair.payment', `Repair ${id}: PKR ${payment.amount.toLocaleString()} received`, payment.method || '', id);
}
