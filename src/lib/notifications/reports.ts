/**
 * The scheduled WhatsApp reports: each reads what it needs from Firestore, once, and returns its
 * document (report-docs.ts), or null when there is nothing to say; dispatch.ts sends it as a PDF.
 */
import { adminDb } from '@/lib/firebase-admin';
import type { AlertDoc } from './doc';
import {
  checklistDoc, dailyReportDoc, endOfDayDoc, givenDoc, karigarDoc, overdueDoc, weeklyDoc,
  type KarigarBalance, type Row,
} from './report-docs';

export const rows = async (name: string): Promise<Row[]> =>
  (await adminDb.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() }));

/**
 * Each karigar's balance from Hisaab, added up as the Hisaab page does: cash (+ they owe the
 * shop, − the shop owes them) and gold (+ the shop's gold with them). Karigar batches were read
 * here once, but a batch is only a period ("April 2026") with no amount and no paid flag.
 */
async function karigarBalances(): Promise<KarigarBalance[]> {
  const snap = await adminDb.collection('hisaab').where('entityType', '==', 'karigar').get();
  const by = new Map<string, KarigarBalance>();
  for (const d of snap.docs) {
    const e = d.data() as Row;
    if (!e.entityId) continue;
    const b = by.get(e.entityId) ?? { name: e.entityName || e.entityId, cash: 0, gold: 0 };
    b.cash += Number(e.cashDebit || 0) - Number(e.cashCredit || 0);
    b.gold += Number(e.goldDebitGrams || 0) - Number(e.goldCreditGrams || 0);
    by.set(e.entityId, b);
  }
  return [...by.values()].filter(b => Math.abs(b.cash) >= 1 || Math.abs(b.gold) >= 0.01);
}

export async function theDayRows() {
  const [orders, invoices, expenses, repairs, extraRevenues] = await Promise.all([
    rows('orders'), rows('invoices'), rows('expenses'), rows('repairs'), rows('additional_revenue'),
  ]);
  return { orders, invoices, expenses, repairs, extraRevenues };
}

export async function buildDailyChecklist(now = new Date()): Promise<AlertDoc | null> {
  const [orders, given, karigars] = await Promise.all([rows('orders'), rows('given_items'), karigarBalances()]);
  return checklistDoc({ orders, invoices: [], expenses: [], given, karigars }, now);
}

export async function buildEndOfDaySummary(now = new Date()): Promise<AlertDoc | null> {
  return endOfDayDoc(await theDayRows(), now);
}

export async function buildDailyReport(now = new Date()): Promise<AlertDoc | null> {
  return dailyReportDoc(await theDayRows(), now);
}

export async function buildWeeklyReport(now = new Date()): Promise<AlertDoc | null> {
  const [orders, invoices, expenses, given, karigars] = await Promise.all([
    rows('orders'), rows('invoices'), rows('expenses'), rows('given_items'), karigarBalances(),
  ]);
  return weeklyDoc({ orders, invoices, expenses, given, karigars }, now);
}

export async function buildOverdueOrders(now = new Date()): Promise<AlertDoc | null> {
  return overdueDoc(await rows('orders'), now);
}

export async function buildGivenItems(now = new Date()): Promise<AlertDoc | null> {
  return givenDoc(await rows('given_items'), now);
}

export async function buildKarigarPayments(now = new Date()): Promise<AlertDoc | null> {
  return karigarDoc(await karigarBalances(), now);
}
