import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { resolveKarigar } from '@/lib/karigar-auth';

/**
 * Lets a karigar mark their OWN piece done (or undo it).
 *
 * Ownership is re-checked server-side against the stored karigarId — the job id
 * coming from the client is never trusted on its own, so a karigar cannot flip
 * another karigar's work by guessing an id.
 */
export async function POST(req: NextRequest) {
  try {
    const identity = await resolveKarigar(req);
    if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { jobId, completed } = await req.json();
    if (typeof jobId !== 'string' || typeof completed !== 'boolean') {
      return NextResponse.json({ error: 'jobId and completed are required' }, { status: 400 });
    }

    // Standalone job: karigar_jobs/<docId>
    if (jobId.startsWith('job:')) {
      const docId = jobId.slice(4);
      const ref = adminDb.collection('karigar_jobs').doc(docId);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      if (snap.data()?.karigarId !== identity.karigarId) {
        return NextResponse.json({ error: 'Not your job' }, { status: 403 });
      }
      await ref.set(
        completed
          ? { status: 'completed', completedDate: new Date().toISOString() }
          : { status: 'pending' },
        { merge: true },
      );
      return NextResponse.json({ ok: true });
    }

    // Order item: order:<orderId>:<index>
    if (jobId.startsWith('order:')) {
      const [, orderId, idxRaw] = jobId.split(':');
      const idx = Number(idxRaw);
      if (!orderId || !Number.isInteger(idx) || idx < 0) {
        return NextResponse.json({ error: 'Bad job id' }, { status: 400 });
      }
      const ref = adminDb.collection('orders').doc(orderId);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

      const data = snap.data() as Record<string, any>;
      const items = Array.isArray(data.items) ? [...data.items] : [];
      const item = items[idx];
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      if (item.karigarId !== identity.karigarId) {
        return NextResponse.json({ error: 'Not your job' }, { status: 403 });
      }

      items[idx] = { ...item, isCompleted: completed };
      await ref.set({ items }, { merge: true });

      // Audit trail so the owner can see who changed what.
      await adminDb.collection('activity_log').add({
        eventType: 'order.update',
        description: `${identity.name} marked an item ${completed ? 'complete' : 'not complete'}`,
        details: `${orderId} · item ${idx + 1} · via karigar portal`,
        entityId: orderId,
        timestamp: new Date().toISOString(),
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Bad job id' }, { status: 400 });
  } catch (e: any) {
    console.error('[api/karigar/complete]', e?.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
