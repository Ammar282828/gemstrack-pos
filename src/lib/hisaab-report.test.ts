import { describe, expect, it } from 'vitest';
import { hisaabAccounts, hisaabLedger, searchAccounts } from './hisaab-report';
import { drawHisaabLedgerPdf, drawHisaabSummaryPdf, hisaabLedgerFileName, hisaabSummaryRow } from './hisaab-pdf';
import { karachiWall } from './wall-clock';
import { WALK_IN_ENTITY, WALK_IN_NAME } from './walk-in';
import type { HisaabEntry } from '@/lib/store';

// Made up.
const row = (id: string, entityId: string, entityName: string, date: string, over: Partial<HisaabEntry> = {}): HisaabEntry => ({
  id, entityId, entityName, entityType: 'customer', date, description: `Row ${id}`,
  cashDebit: 0, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0, ...over,
});

const entries: HisaabEntry[] = [
  row('1', 'C1', 'Zara Test', '2026-10-01T05:00:00.000Z', { cashDebit: 10_000 }),
  row('2', 'C1', 'Zara Test', '2026-10-03T05:00:00.000Z', { cashCredit: 4_000 }),
  row('3', 'K1', 'Ali Karigar', '2026-10-02T05:00:00.000Z', { entityType: 'karigar', goldCreditGrams: 5.5, cashCredit: 2_000 }),
  row('4', 'C2', 'Settled Test', '2026-10-02T05:00:00.000Z', { cashDebit: 1_000 }),
  row('5', 'C2', 'Settled Test', '2026-10-04T05:00:00.000Z', { cashCredit: 1_000 }),
  row('6', WALK_IN_ENTITY, 'Walk-in Customer', '2026-10-05T05:00:00.000Z', { cashDebit: 3_000, linkedInvoiceId: 'INV-9' }),
  row('7', '', 'Nobody', '2026-10-05T05:00:00.000Z', { cashDebit: 99 }),
];

describe('hisaabAccounts', () => {
  it('debit less credit per person, only what is outstanding, by name', () => {
    const { accounts, walkInInvoiceIds } = hisaabAccounts(entries);
    expect(accounts.map((a) => [a.entityName, a.cashBalance, a.goldBalance])).toEqual([
      ['Ali Karigar', -2_000, -5.5],
      [WALK_IN_NAME, 3_000, 0],
      ['Zara Test', 6_000, 0],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    expect([...walkInInvoiceIds]).toEqual(['INV-9']);
  });

  it('the search keeps names holding it, any case', () => {
    const { accounts } = hisaabAccounts(entries);
    expect(searchAccounts(accounts, 'zara').map((a) => a.entityId)).toEqual(['C1']);
    expect(searchAccounts(accounts, '')).toHaveLength(3);
  });

  it("the summary's words: receivable, payable", () => {
    const { accounts } = hisaabAccounts(entries);
    const ali = accounts.find((a) => a.entityId === 'K1')!;
    expect(hisaabSummaryRow(ali, 0)).toEqual([1, 'Ali Karigar', 'Karigar', '2,000 (Payable)', '5.500 (Payable)']);
    const zara = accounts.find((a) => a.entityId === 'C1')!;
    expect(hisaabSummaryRow(zara, 2)[3]).toBe('6,000 (Receivable)');
  });

  it('draws the summary', () => {
    const doc = drawHisaabSummaryPdf(hisaabAccounts(entries).accounts, karachiWall(new Date('2026-10-17T07:00:00Z')));
    const t = new TextDecoder('latin1').decode(doc.output('arraybuffer'));
    expect(t).toContain('Hisaab Summary Report');
    expect(t).toContain('Zara Test');
    expect(t).toContain('6,000 \\(Receivable\\)');
  });
});

describe('hisaabLedger', () => {
  it('oldest first, each row with the balance after it', () => {
    const shuffled = [entries[1], entries[0]];
    const r = hisaabLedger(shuffled, 'C1');
    expect(r.lines.map((l) => [l.id, l.runningCashBalance])).toEqual([['1', 10_000], ['2', 6_000]]);
    expect([r.finalCashBalance, r.finalGoldBalance]).toEqual([6_000, 0]);
  });

  it('nobody else’s rows', () => {
    expect(hisaabLedger(entries, 'K1').lines.map((l) => l.id)).toEqual(['3']);
    expect(hisaabLedger(entries, 'NOPE')).toEqual({ lines: [], finalCashBalance: 0, finalGoldBalance: 0 });
  });

  it('draws the statement, its days the shop’s', () => {
    const late = row('8', 'C1', 'Zara Test', '2026-09-30T20:30:00.000Z', { cashDebit: 500 }); // 1 Oct, 01:30 in the shop
    const r = hisaabLedger([late, ...entries], 'C1');
    const asOf = karachiWall(new Date('2026-10-17T07:00:00Z'));
    const doc = drawHisaabLedgerPdf({ name: 'Zara Test', entityType: 'customer', ...r, asOf, wall: karachiWall });
    const t = new TextDecoder('latin1').decode(doc.output('arraybuffer'));
    expect(t).toContain('Ledger Statement');
    expect(t).toContain('Receivable: PKR 6,500.00');
    expect(t).toContain('01-Oct-26');
    expect(hisaabLedgerFileName('Zara Test', asOf)).toBe('Ledger-Zara Test-2026-10-17.pdf');
  });
});

describe('reminderMessage', () => {
  it('says what is owed, from the shop, and nothing when nothing is owed', async () => {
    const { reminderMessage } = await import('./hisaab-report');
    const m = reminderMessage('Test Customer', 'Example Jewellers', 12500)!;
    expect(m).toContain('Dear Test Customer');
    expect(m).toContain('from Example Jewellers');
    expect(m).toContain('*Amount Due:* PKR 12,500.00');
    expect(reminderMessage('A', 'B', 0)).toBeNull();
    expect(reminderMessage('A', 'B', -5)).toBeNull();
  });
});
