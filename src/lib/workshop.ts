/**
 * Workshop job model.
 *
 * The shop's karigar work comes from two places:
 *   1. Customer orders — each OrderItem can carry a `karigarId` (assigned in the
 *      order form) and an `isCompleted` flag.
 *   2. Standalone `KarigarJob` records — stock pieces, repairs, samples: work
 *      that never had a customer order behind it.
 *
 * The Workshop dashboard needs one flat list across both, so everything is
 * normalised into `WorkshopJob` here. Urgency is derived from age, matching the
 * 7-day / 14-day thresholds the overdue WhatsApp alerts already use.
 */

import type { Order, KarigarJob, KarigarJobStatus, Karigar, Invoice, InvoiceItem } from './store';
import { categoryTitle as resolveCategoryTitle, displayKarat } from './categories';
import { describePlating } from './materials';

export const WARN_DAYS = 7;
export const CRITICAL_DAYS = 14;

export type WorkshopJobSource = 'order' | 'manual' | 'invoice';
export type WorkshopUrgency = 'ok' | 'warning' | 'critical';

export const UNASSIGNED_ID = '__unassigned__';

export interface WorkshopJob {
  id: string;                 // stable unique key
  source: WorkshopJobSource;
  karigarId: string;          // UNASSIGNED_ID when nobody is on it
  karigarName: string;
  description: string;
  status: KarigarJobStatus;
  assignedDate: string;       // ISO
  completedDate?: string;
  ageDays: number;
  urgency: WorkshopUrgency;
  // context
  orderId?: string;
  invoiceId?: string;
  /** Sold online — surfaced in the Workshop so it can be assigned, and
   *  highlighted so it is distinguishable from bench work off an order. */
  isOnline?: boolean;
  itemIndex?: number;
  customerName?: string;
  category?: string;
  metalType?: string;
  karat?: string;
  weightG?: number;
  quantity?: number;
  size?: string;
  referenceSku?: string;
  sampleGiven?: boolean;
  sampleImage?: string;
  plating?: string;
  value?: number;             // order item estimate, or agreed cost on a manual job
  notes?: string;             // merged instructions — see mergeInstructions
}

export function daysSince(iso: string | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export function urgencyOf(status: KarigarJobStatus, ageDays: number): WorkshopUrgency {
  if (status === 'completed') return 'ok';
  if (ageDays >= CRITICAL_DAYS) return 'critical';
  if (ageDays >= WARN_DAYS) return 'warning';
  return 'ok';
}

function categoryTitle(id?: string): string | undefined {
  return resolveCategoryTitle(id);
}

/**
 * Flatten active orders + manual jobs into one workshop job list.
 * Cancelled/Refunded orders are excluded — that work is dead.
 * Items on orders already turned into invoices are excluded too (delivered).
 */
export function buildWorkshopJobs(
  orders: Order[],
  karigarJobs: KarigarJob[],
  karigars: Karigar[],
  opts: { includeInvoicedOrders?: boolean; includePendingOrders?: boolean; invoices?: Invoice[] } = {},
): WorkshopJob[] {
  const nameById = new Map(karigars.map(k => [k.id, k.name]));
  const out: WorkshopJob[] = [];

  for (const order of orders || []) {
    if (!order) continue;
    if (order.status === 'Cancelled' || order.status === 'Refunded') continue;
    if (order.invoiceId && !opts.includeInvoicedOrders) continue;
    // A Pending order has not been handed to the workshop yet, so its pieces
    // are not physically with any karigar — they would otherwise pad every
    // list with work nobody has started.
    if (order.status === 'Pending' && !opts.includePendingOrders) continue;

    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach((item, idx) => {
      if (!item) return;
      const rawId = item.karigarId && item.karigarId !== 'none' ? item.karigarId : '';
      const karigarId = rawId || UNASSIGNED_ID;
      const karigarName = rawId ? (nameById.get(rawId) || 'Unknown karigar') : 'Unassigned';

      // An order marked Completed means the work is done, even if the
      // per-item checkboxes were never ticked one by one — otherwise old
      // finished pieces linger as "pending" forever.
      const status: KarigarJobStatus = (item.isCompleted || order.status === 'Completed')
        ? 'completed'
        : order.status === 'In Progress' ? 'in-progress' : 'pending';

      const ageDays = daysSince(order.createdAt);
      out.push({
        id: `order:${order.id}:${idx}`,
        source: 'order',
        karigarId,
        karigarName,
        description: item.description || 'Item',
        status,
        assignedDate: order.createdAt,
        ageDays,
        urgency: urgencyOf(status, ageDays),
        orderId: order.id,
        itemIndex: idx,
        customerName: order.customerName || 'Walk-in',
        category: categoryTitle(item.itemCategory),
        metalType: item.metalType,
        karat: displayKarat(item.metalType, item.karat),
        weightG: item.estimatedWeightG,
        quantity: 1,
        size: item.size || undefined,
        referenceSku: item.referenceSku || undefined,
        sampleGiven: !!item.sampleGiven,
        sampleImage: item.sampleImageDataUri || undefined,
        plating: describePlating(item),
        value: item.totalEstimate ?? 0,
        notes: mergeInstructions(item),
      });
    });
  }

  for (const job of karigarJobs || []) {
    if (!job) continue;
    const ageDays = daysSince(job.assignedDate);
    const rawId = job.karigarId || '';
    out.push({
      id: `job:${job.id}`,
      source: 'manual',
      karigarId: rawId || UNASSIGNED_ID,
      karigarName: rawId ? (nameById.get(rawId) || job.karigarName || 'Unknown karigar') : 'Unassigned',
      description: job.description,
      status: job.status,
      assignedDate: job.assignedDate,
      completedDate: job.completedDate,
      ageDays,
      urgency: urgencyOf(job.status, ageDays),
      category: categoryTitle(job.itemCategory) || job.itemCategory,
      metalType: job.metalType,
      karat: displayKarat(job.metalType, job.karat),
      weightG: job.weightG,
      quantity: job.quantity ?? 1,
      size: job.size || undefined,
      value: job.agreedCost ?? 0,
      notes: mergeInstructions(job),
    });
  }

  // ── Sold pieces that still need bench work ──
  // Shopify orders arrive as invoices rather than orders, so they would never
  // reach the Workshop otherwise. Also included: any invoice line someone has
  // deliberately assigned to a karigar — a resize, a replate, a repair.
  for (const inv of opts.invoices || []) {
    if (!inv || inv.status === 'Refunded') continue;
    // An online sale only needs bench work while it is still unfulfilled.
    // Shipped orders — and the older bulk imports that carry no fulfilment
    // status at all — would otherwise bury the board: 203 items instead of 12.
    const isOnline = String(inv.source || '').startsWith('shopify')
      && /unfulfilled/i.test(String(inv.notes || ''));
    const items = (Array.isArray(inv.items) ? inv.items : Object.values(inv.items || {})) as InvoiceItem[];
    items.forEach((item, idx) => {
      if (!item) return;
      const assigned = item.karigarId && item.karigarId !== 'none' ? item.karigarId : '';
      // Only online sales come in automatically; everything else appears once
      // it has actually been handed to someone.
      if (!isOnline && !assigned) return;
      if (item.isCompleted) return;

      const ageDays = daysSince(inv.createdAt);
      out.push({
        id: `invoice:${inv.id}:${idx}`,
        source: 'invoice',
        karigarId: assigned || UNASSIGNED_ID,
        karigarName: assigned ? (nameById.get(assigned) || 'Unknown karigar') : 'Unassigned',
        description: item.name || 'Item',
        status: 'pending',
        assignedDate: inv.createdAt,
        ageDays,
        urgency: urgencyOf('pending', ageDays),
        invoiceId: inv.id,
        isOnline,
        itemIndex: idx,
        customerName: inv.customerName || 'Walk-in',
        category: categoryTitle(item.itemCategory),
        metalType: item.metalType,
        karat: displayKarat(item.metalType, item.karat),
        plating: describePlating(item),
        weightG: item.metalWeightG,
        quantity: item.quantity ?? 1,
        size: item.size || undefined,
        value: item.itemTotal ?? 0,
        notes: mergeInstructions(item),
      });
    });
  }

  // Newest-assigned first, but push completed work to the bottom.
  return out.sort((a, b) => {
    if ((a.status === 'completed') !== (b.status === 'completed')) return a.status === 'completed' ? 1 : -1;
    return new Date(b.assignedDate).getTime() - new Date(a.assignedDate).getTime();
  });
}

export interface KarigarWorkload {
  karigarId: string;
  karigarName: string;
  jobs: WorkshopJob[];
  active: number;
  pending: number;
  inProgress: number;
  completed: number;
  overdue: number;      // active jobs >= WARN_DAYS
  critical: number;     // active jobs >= CRITICAL_DAYS
  oldestActiveDays: number;
  totalValue: number;   // value of active work
  totalWeightG: number; // weight of active work
}

/** Group jobs per karigar, busiest / most-at-risk first. */
export function groupByKarigar(jobs: WorkshopJob[]): KarigarWorkload[] {
  const map = new Map<string, WorkshopJob[]>();
  for (const j of jobs) {
    if (!map.has(j.karigarId)) map.set(j.karigarId, []);
    map.get(j.karigarId)!.push(j);
  }

  const loads: KarigarWorkload[] = [...map.entries()].map(([karigarId, list]) => {
    const activeJobs = list.filter(j => j.status !== 'completed');
    return {
      karigarId,
      karigarName: list[0]?.karigarName || 'Unknown',
      jobs: list,
      active: activeJobs.length,
      pending: list.filter(j => j.status === 'pending').length,
      inProgress: list.filter(j => j.status === 'in-progress').length,
      completed: list.filter(j => j.status === 'completed').length,
      overdue: activeJobs.filter(j => j.urgency !== 'ok').length,
      critical: activeJobs.filter(j => j.urgency === 'critical').length,
      oldestActiveDays: activeJobs.reduce((m, j) => Math.max(m, j.ageDays), 0),
      totalValue: activeJobs.reduce((s, j) => s + (j.value || 0), 0),
      totalWeightG: activeJobs.reduce((s, j) => s + (j.weightG || 0), 0),
    };
  });

  // Unassigned pinned first (it needs action), then most critical, then busiest.
  return loads.sort((a, b) => {
    if (a.karigarId === UNASSIGNED_ID) return -1;
    if (b.karigarId === UNASSIGNED_ID) return 1;
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    return b.active - a.active;
  });
}

/** Plain-text job list for a karigar — WhatsApp / print friendly. */
export function formatJobListForShare(load: KarigarWorkload, shopName = 'MINA'): string {
  const active = load.jobs.filter(j => j.status !== 'completed');
  const lines: string[] = [
    `*${shopName} — Work List*`,
    `*${load.karigarName}*`,
    `${active.length} pending item${active.length === 1 ? '' : 's'}`,
    '',
  ];

  if (!active.length) {
    lines.push('No pending work. ✅');
    return lines.join('\n');
  }

  active
    .slice()
    .sort((a, b) => b.ageDays - a.ageDays)
    .forEach((j, i) => {
      const flag = j.urgency === 'critical' ? ' 🔴' : j.urgency === 'warning' ? ' ⚠️' : '';
      lines.push(`${i + 1}. ${j.description}${flag}`);
      const meta: string[] = [];
      if (j.category) meta.push(j.category);
      if (j.weightG) meta.push(`${j.weightG}g`);
      if (j.karat) meta.push(String(j.karat).toUpperCase());
      if (meta.length) lines.push(`   ${meta.join(' · ')}`);
      if (j.orderId) lines.push(`   Order ${j.orderId}${j.customerName ? ` (${j.customerName})` : ''}`);
      lines.push(`   ${j.ageDays} day${j.ageDays === 1 ? '' : 's'} since given`);
    });

  return lines.join('\n');
}

/**
 * Group pieces under the order they belong to.
 *
 * A karigar receives work by order — several pieces of one order are made
 * together — so the order reference reads better as the heading than any one
 * piece's name. Stock work has no order, so each stock piece stands alone.
 *
 * Written against a minimal shape so both the owner Workshop (WorkshopJob) and
 * the karigar portal (its own leaner Job type) can share it.
 */
export interface OrderGroupable {
  id: string;
  orderId?: string;
  invoiceId?: string;
  source: 'order' | 'manual' | 'invoice';
  ageDays: number;
  assignedDate: string;
}

export interface JobOrderGroup<T extends OrderGroupable> {
  key: string;
  orderId?: string;
  invoiceId?: string;
  isStock: boolean;
  jobs: T[];
  ageDays: number;
  assignedDate: string;
}

export function groupJobsByOrder<T extends OrderGroupable>(jobs: T[]): JobOrderGroup<T>[] {
  const groups = new Map<string, JobOrderGroup<T>>();
  for (const j of jobs) {
    // Sold pieces group under their invoice; stock pieces stand alone.
    const key = j.source === 'order' && j.orderId ? `order:${j.orderId}`
      : j.source === 'invoice' && j.invoiceId ? `invoice:${j.invoiceId}`
      : `job:${j.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.jobs.push(j);
      existing.ageDays = Math.max(existing.ageDays, j.ageDays);
    } else {
      groups.set(key, {
        key,
        orderId: j.source === 'order' ? j.orderId : undefined,
        invoiceId: j.source === 'invoice' ? j.invoiceId : undefined,
        isStock: j.source === 'manual',
        jobs: [j],
        ageDays: j.ageDays,
        assignedDate: j.assignedDate,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.ageDays - a.ageDays);
}

/**
 * One instruction block per item.
 *
 * Making notes historically lived in three fields — stoneDetails,
 * diamondDetails and the order form's "Admin-Only Note" — which meant a
 * karigar saw two or three separate boxes saying much the same thing. They are
 * merged here (blank and duplicate lines dropped) so every surface renders a
 * single set of instructions.
 */
export function mergeInstructions(item: {
  stoneDetails?: string;
  diamondDetails?: string;
  adminNote?: string;
  notes?: string;
}): string | undefined {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of [item.stoneDetails, item.diamondDetails, item.adminNote, item.notes]) {
    const v = (raw || '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    parts.push(v);
  }
  return parts.length ? parts.join('\n') : undefined;
}
