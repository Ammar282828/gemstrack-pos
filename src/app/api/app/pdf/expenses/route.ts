/**
 * The Expenses page's report as a PDF (lib/expense-report-pdf.ts), drawn on the server for the iPhone
 * app to show and share natively, for the filters on the phone's screen: `period` (this-month,
 * last-month, last-30, this-year, all, custom), `start` / `end` (yyyy-MM-dd, a custom range),
 * `grouping` (day, week, month), `category` ('All' or one), `search`.
 *
 * GET with them in the query, which is how the app's PDF screen fetches (PDFDocumentScreen only
 * GETs); POST with them as JSON for anything that would rather send a body. Same report either way.
 * Owners only (lib/app-pdf-owner.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfResponse } from '@/lib/app-pdf';
import { expenseReportPdf, pdfOwner } from '@/lib/app-pdf-owner';
import { expenseFiltersFrom } from '@/lib/expense-report';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function report(req: NextRequest, raw: Record<string, unknown>) {
  const who = await pdfOwner(req, 'The expense report');
  if (who instanceof NextResponse) return who;
  try {
    return pdfResponse(await expenseReportPdf(expenseFiltersFrom(raw)));
  } catch (e) {
    console.error('[/api/app/pdf/expenses]', e);
    return NextResponse.json({ error: 'The expense report could not be drawn.' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return report(req, Object.fromEntries(req.nextUrl.searchParams.entries()));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return report(req, body && typeof body === 'object' && !Array.isArray(body) ? body : {});
}
