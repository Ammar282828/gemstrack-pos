/**
 * GET with "Authorization: Widget <key>": the widget's four figures (lib/widget/summary.ts),
 * shaped for the phone to show as they are. Nothing else is readable with a widget key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { currentWidgetSummary, widgetKeyOwner } from '@/lib/widget/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const key = /^Widget\s+(\S+)$/.exec(req.headers.get('authorization') || '')?.[1] || '';
  if (!(await widgetKeyOwner(key))) return NextResponse.json({ error: 'Open the app and sign in again.' }, { status: 401 });
  try {
    return NextResponse.json(await currentWidgetSummary(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[widget/summary]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'The figures could not be worked out.' }, { status: 500 });
  }
}
