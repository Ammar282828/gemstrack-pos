import { describe, expect, it } from 'vitest';
import { hisaabCsvDate, hisaabCsvProblems, hisaabCsvRefusal, hisaabImportEntries, parseHisaabCsv } from './hisaab-csv';

// Made-up ledgers only.
const NOW = new Date('2026-10-09T08:00:00.000Z');
const csv = (lines: string[]) => lines.join('\n');

describe('hisaabCsvDate', () => {
  it('reads each of the page\'s formats as the start of that day in Karachi', () => {
    expect(hisaabCsvDate('01-Oct-26', NOW)).toBe('2026-09-30T19:00:00.000Z');
    expect(hisaabCsvDate('01/10/2026', NOW)).toBe('2026-09-30T19:00:00.000Z');
    expect(hisaabCsvDate('2026-10-01', NOW)).toBe('2026-09-30T19:00:00.000Z');
    expect(hisaabCsvDate('01-10-2026', NOW)).toBe('2026-09-30T19:00:00.000Z');
  });

  it('tries the day first: 03/04/2026 is the 3rd of April, and 04/25/2026 can only be April', () => {
    expect(hisaabCsvDate('03/04/2026', NOW)).toBe('2026-04-02T19:00:00.000Z');
    expect(hisaabCsvDate('04/25/2026', NOW)).toBe('2026-04-24T19:00:00.000Z');
  });

  it('gives nothing for a blank or a date no format reads', () => {
    expect(hisaabCsvDate(undefined, NOW)).toBeNull();
    expect(hisaabCsvDate('  ', NOW)).toBeNull();
    expect(hisaabCsvDate('next Tuesday', NOW)).toBeNull();
    expect(hisaabCsvDate('31/02/2026', NOW)).toBeNull();
  });
});

describe('parseHisaabCsv', () => {
  it('reads the rows as the page does: commas as thousands, a missing amount as 0', () => {
    const r = parseHisaabCsv(csv([
      'Date,Details,Cash IN,Cash OUT',
      '01/10/2026,Advance for a ring,"25,000",',
      '02/10/2026,Balance returned,,1500.5',
      '',
    ]), NOW);
    expect(r).toEqual({
      ok: true,
      rows: [
        { date: '2026-09-30T19:00:00.000Z', isValidDate: true, description: 'Advance for a ring', cashIn: 25_000, cashOut: 0 },
        { date: '2026-10-01T19:00:00.000Z', isValidDate: true, description: 'Balance returned', cashIn: 0, cashOut: 1500.5 },
      ],
    });
  });

  it('marks a row whose date did not read, and keeps the other columns', () => {
    const r = parseHisaabCsv(csv(['Date,Details,Cash IN,Cash OUT', 'soon,Something,100,0']), NOW);
    expect(r.ok && r.rows[0]).toEqual({ date: 'Invalid Date', isValidDate: false, description: 'Something', cashIn: 100, cashOut: 0 });
  });

  it('says which columns are missing, in the page\'s words', () => {
    expect(parseHisaabCsv(csv(['Date,Details,Amount', '01/10/2026,x,1']), NOW)).toEqual({
      ok: false,
      error: 'Missing required columns in CSV: Cash IN, Cash OUT. Please ensure your file has the correct headers.',
    });
  });

  it('reads past a spreadsheet\'s byte-order mark', () => {
    const r = parseHisaabCsv('﻿' + csv(['Date,Details,Cash IN,Cash OUT', '2026-10-01,x,10,']), NOW);
    expect(r.ok && r.rows).toHaveLength(1);
  });

  it('passes Papa Parse\'s own complaint on', () => {
    const r = parseHisaabCsv(csv(['Date,Details,Cash IN,Cash OUT', '01/10/2026,"never closed,1,2']), NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Error parsing CSV: /);
  });
});

describe('the rows that stop an import', () => {
  const rows = [
    { date: '2026-09-30T19:00:00.000Z', isValidDate: true, description: 'a', cashIn: 10, cashOut: 0 },
    { date: 'Invalid Date', isValidDate: false, description: 'b', cashIn: 10, cashOut: 0 },
    { date: '2026-09-30T19:00:00.000Z', isValidDate: true, description: 'c', cashIn: 0, cashOut: 0 },
  ];

  it('are a bad date or no amount at all', () => {
    expect(hisaabCsvProblems(rows).map((r) => r.description)).toEqual(['b', 'c']);
    expect(hisaabCsvRefusal(rows)).toBe('There are 2 rows with invalid dates or zero amounts. Please correct the file and re-upload.');
    expect(hisaabCsvRefusal(rows.slice(0, 1))).toBeNull();
  });
});

describe('hisaabImportEntries', () => {
  it('writes Cash IN as their credit and Cash OUT as their debit, and no metal', () => {
    const [e] = hisaabImportEntries(
      [{ date: '2026-09-30T19:00:00.000Z', isValidDate: true, description: 'Old balance', cashIn: 500, cashOut: 2000 }],
      { id: 'cust-1', type: 'customer', name: 'Demo Customer' },
    );
    expect(e).toEqual({
      entityId: 'cust-1', entityType: 'customer', entityName: 'Demo Customer', date: '2026-09-30T19:00:00.000Z',
      description: 'Old balance', cashCredit: 500, cashDebit: 2000, goldCreditGrams: 0, goldDebitGrams: 0,
    });
  });
});
