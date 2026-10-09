/**
 * Settings → Import hisaab (src/app/settings/hisaab-import): one person's old ledger, from a CSV such as
 * Easy Khata exports, read and checked before anything is written. The one copy of the page's reading, for
 * the iPhone app (/api/app/imports to preview, /api/app/write `importHisaab` to write, both reading the file
 * again on the server) and for the page, which reads it in the browser with the same Papa Parse and date-fns.
 *
 * - The file must have the columns Date, Details, Cash IN and Cash OUT, spelled so.
 * - A date may be written dd-MMM-yy, dd/MM/yyyy, MM/dd/yyyy, yyyy-MM-dd or dd-MM-yyyy, tried in that order
 *   (so 03/04/2026 is the 3rd of April). It is the start of that day in Karachi, as the page makes it on the
 *   shop's own devices (the server's clock is UTC).
 * - Cash IN is money received from the person (a credit to them), Cash OUT money given (a debit). Commas
 *   are thousands. Metal is not imported: those rows are added by hand.
 * - Nothing is written while any row has a date that did not read or no amount at all.
 */

import Papa from 'papaparse';
import { isValid, parse } from 'date-fns';
import type { HisaabEntityType, HisaabEntry } from '@/lib/store';

export const HISAAB_CSV_COLUMNS = ['Date', 'Details', 'Cash IN', 'Cash OUT'] as const;
export const HISAAB_DATE_FORMATS = ['dd-MMM-yy', 'dd/MM/yyyy', 'MM/dd/yyyy', 'yyyy-MM-dd', 'dd-MM-yyyy'] as const;

/** Pakistan keeps no daylight saving: Karachi is UTC+5 all year. */
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

export type HisaabCsvRow = {
  /** ISO, or 'Invalid Date' when the date did not read. */
  date: string;
  description: string;
  cashIn: number;
  cashOut: number;
  isValidDate: boolean;
};

export type HisaabCsvResult = { ok: true; rows: HisaabCsvRow[] } | { ok: false; error: string };

/** A date as the shop wrote it, as the start of that day in Karachi; null when no format reads it. */
export function hisaabCsvDate(raw: string | undefined, now: Date = new Date()): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  for (const format of HISAAB_DATE_FORMATS) {
    const d = parse(s, format, now);
    if (isValid(d)) {
      // date-fns gives midnight on this machine's clock; the day it read is what counts.
      return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - KARACHI_OFFSET_MS).toISOString();
    }
  }
  return null;
}

const amount = (v: unknown) => parseFloat(String(v ?? '').replace(/,/g, '')) || 0;

/** The file read as the page reads it, or what is wrong with it, in the page's words. */
export function parseHisaabCsv(text: string, now: Date = new Date()): HisaabCsvResult {
  // A spreadsheet's byte-order mark would otherwise sit in front of the first column's name.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const results = Papa.parse<Record<string, string | undefined>>(body, { header: true, skipEmptyLines: true });
  if (results.errors.length) return { ok: false, error: `Error parsing CSV: ${results.errors[0].message}` };

  const actual = results.meta.fields || [];
  const missing = HISAAB_CSV_COLUMNS.filter((h) => !actual.includes(h));
  if (missing.length > 0) {
    return { ok: false, error: `Missing required columns in CSV: ${missing.join(', ')}. Please ensure your file has the correct headers.` };
  }

  const rows = results.data.map((row): HisaabCsvRow => {
    const date = hisaabCsvDate(row.Date, now);
    return {
      date: date ?? 'Invalid Date',
      isValidDate: date !== null,
      description: row.Details || '',
      cashIn: amount(row['Cash IN']),
      cashOut: amount(row['Cash OUT']),
    };
  });
  return { ok: true, rows };
}

/** The rows that stop the import: a date that did not read, or neither amount. */
export const hisaabCsvProblems = (rows: HisaabCsvRow[]) => rows.filter((r) => !r.isValidDate || (!r.cashIn && !r.cashOut));

/** The page's refusal when any row is wrong; null when every row is fine. */
export function hisaabCsvRefusal(rows: HisaabCsvRow[]): string | null {
  const bad = hisaabCsvProblems(rows).length;
  return bad > 0 ? `There are ${bad} rows with invalid dates or zero amounts. Please correct the file and re-upload.` : null;
}

export type HisaabImportEntity = { id: string; type: HisaabEntityType; name: string };

/** The ledger rows the file becomes for one person, as the page writes them. */
export function hisaabImportEntries(rows: HisaabCsvRow[], entity: HisaabImportEntity): Omit<HisaabEntry, 'id'>[] {
  return rows.map((row) => ({
    entityId: entity.id,
    entityType: entity.type,
    entityName: entity.name,
    date: row.date,
    description: row.description,
    cashCredit: row.cashIn, // Cash IN for us is a credit from the customer
    cashDebit: row.cashOut, // Cash OUT from us is a debit for the customer
    goldCreditGrams: 0, // CSV doesn't support gold import
    goldDebitGrams: 0,
  }));
}
