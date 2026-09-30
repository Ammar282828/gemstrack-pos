/**
 * GET ?month=2026-09 → the monthly report PDF for that Karachi month (this month so far when
 * none is given): the figures on Analytics' rules and every sale listed (lib/reports).
 *
 * Open while sign-in is off, like the rest of the ERP's reading (its Firestore is open too);
 * otherwise the owner's token, or the scheduler's key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { isOwnerEmail, verifyRequestEmail } from '@/lib/karigar-auth';
import { karachiMonth, monthKey, parseMonth } from '@/lib/reports/monthly';
import { monthlyReportPdf } from '@/lib/reports/monthly-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

export async function GET(req: NextRequest) {
  const allowed = OPEN_ACCESS || isCronAuthorized(req, { strict: true }) || isOwnerEmail(await verifyRequestEmail(req));
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const asked = req.nextUrl.searchParams.get('month');
  const month = asked ? parseMonth(asked) : karachiMonth(new Date());
  if (!month) return NextResponse.json({ error: 'Month must look like 2026-09.' }, { status: 400 });
  if (monthKey(month) > monthKey(karachiMonth(new Date()))) return NextResponse.json({ error: 'That month has not started yet.' }, { status: 400 });

  try {
    const { bytes, fileName } = await monthlyReportPdf(month);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[/api/reports/monthly]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not make the report.' }, { status: 500 });
  }
}
