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

import type { Order, KarigarJob, KarigarJobStatus, Karigar } from './store';
import { staticCategories } from './store';

export const WARN_DAYS = 7;
export const CRITICAL_DAYS = 14;

export type WorkshopJobSource = 'order' | 'manual';
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
  itemIndex?: number;
  customerName?: string;
  category?: string;
  metalType?: string;
  karat?: string;
  weightG?: number;
  quantity?: number;
  value?: number;             // order item estimate, or agreed cost on a manual job
  notes?: string;
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
  if (!id) return undefined;
  return staticCategories.find(c => c.id === id)?.title || undefined;
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
  opts: { includeInvoicedOrders?: boolean } = {},
): WorkshopJob[] {
  const nameById = new Map(karigars.map(k => [k.id, k.name]));
  const out: WorkshopJob[] = [];

  for (const order of orders || []) {
    if (!order) continue;
    if (order.status === 'Cancelled' || order.status === 'Refunded') continue;
    if (order.invoiceId && !opts.includeInvoicedOrders) continue;

    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach((item, idx) => {
      if (!item) return;
      const rawId = item.karigarId && item.karigarId !== 'none' ? item.karigarId : '';
      const karigarId = rawId || UNASSIGNED_ID;
      const karigarName = rawId ? (nameById.get(rawId) || 'Unknown karigar') : 'Unassigned';

      const status: KarigarJobStatus = item.isCompleted
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
        karat: item.karat,
        weightG: item.estimatedWeightG,
        quantity: 1,
        value: item.totalEstimate ?? 0,
        notes: item.stoneDetails || item.diamondDetails || undefined,
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
      karat: job.karat,
      weightG: job.weightG,
      quantity: job.quantity ?? 1,
      value: job.agreedCost ?? 0,
      notes: job.notes,
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
