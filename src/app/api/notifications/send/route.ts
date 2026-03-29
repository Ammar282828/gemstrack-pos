import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export async function POST(req: NextRequest) {
  try {
    const { to, message } = await req.json();

    if (!to || !message) {
      return NextResponse.json({ error: 'Missing to or message' }, { status: 400 });
    }

    await sendWhatsAppMessage(to, message);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/notifications/send]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
