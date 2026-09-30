/**
 * One karigar's position with the shop, on one page (the audit of 2026-10-01: it took four screens,
 * and his own page showed neither his work on the bench nor his cash balance).
 *
 *   bench      his open jobs — from orders (Pending included) and standalone jobs (workshop.ts)
 *   metal out  two figures, side by side and never added: what the pieces on his bench weigh (an
 *              estimate — the weights typed on the jobs) and the Gold khata in Hisaab (what was
 *              actually handed over and returned). They measure different things; a sum would be
 *              a number nobody weighed.
 *   given      given items still out with him — by recipientId, else by his name for records
 *              written before the id was kept
 *   cash       his Hisaab cash balance: positive, he holds the shop's money (an advance); negative,
 *              the shop owes him. Pay batches are what was paid, shown beside it.
 * Read only. Ticking "Given" on a job does not post to Hisaab (the owner's call: the report asks).
 */

import type { WorkshopJob } from '@/lib/workshop';

type Given = { id: string; status: string; recipientType: string; recipientName: string; recipientId?: string; description: string; date: string };
type Entry = { entityType: string; entityId: string; cashDebit: number; cashCredit: number; goldDebitGrams?: number; goldCreditGrams?: number };

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export function karigarPosition(o: { karigarId: string; karigarName: string; jobs: WorkshopJob[]; givenItems: Given[]; hisaab: Entry[] }) {
  const bench = o.jobs
    .filter(j => j.karigarId === o.karigarId && j.status !== 'completed')
    .sort((a, b) => b.ageDays - a.ageDays);
  const onBench: Record<string, number> = {};
  let unweighed = 0;
  for (const j of bench) {
    const w = Number(j.weightG) || 0;
    if (!w) { unweighed += 1; continue; }
    const key = [j.metalType || 'metal', j.karat].filter(Boolean).join(' ');
    onBench[key] = (onBench[key] ?? 0) + w;
  }
  const mine = o.hisaab.filter(h => h.entityType === 'karigar' && h.entityId === o.karigarId);
  const khataGiven = mine.reduce((s, h) => s + (Number(h.goldDebitGrams) || 0), 0);
  const khataBack = mine.reduce((s, h) => s + (Number(h.goldCreditGrams) || 0), 0);
  const cashBalance = mine.reduce((s, h) => s + (Number(h.cashDebit) || 0) - (Number(h.cashCredit) || 0), 0);
  const given = o.givenItems.filter(g => g.status === 'out' && (g.recipientId
    ? g.recipientId === o.karigarId
    : g.recipientType === 'karigar' && norm(g.recipientName) === norm(o.karigarName)));
  return {
    bench,
    metalOnBench: { byMetal: onBench, unweighed },
    goldKhata: { given: khataGiven, back: khataBack, net: khataGiven - khataBack },
    given,
    cashBalance,
  };
}
