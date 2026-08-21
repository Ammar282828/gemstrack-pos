import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { resolveKarigar, verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';
import { categoryTitle, displayKarat } from '@/lib/categories';
import { mergeInstructions } from '@/lib/workshop';
import { describePlating } from '@/lib/materials';

/**
 * Returns the signed-in karigar's own work list and account balance.
 *
 * Everything is assembled server-side and hand-picked: a karigar never receives
 * customer names, phone numbers, item prices, order totals or any other
 * karigar's data — even though the underlying order documents contain them.
 */

const WARN_DAYS = 7;
const CRITICAL_DAYS = 14;

function daysSince(iso: string | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function urgency(ageDays: number, done: boolean): 'ok' | 'warning' | 'critical' {
  if (done) return 'ok';
  if (ageDays >= CRITICAL_DAYS) return 'critical';
  if (ageDays >= WARN_DAYS) return 'warning';
  return 'ok';
}

export async function GET(req: NextRequest) {
  try {
    const email = await verifyRequestEmail(req);
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const owner = isOwnerEmail(email);

    // Owner preview: shop owners can look at any karigar's portal exactly as
    // that karigar sees it. This exposes nothing new — owners already have full
    // access to every collection — it just makes the filtered view inspectable.
    const previewId = req.nextUrl.searchParams.get('karigarId');
    let karigarId: string;
    let name: string;

    if (owner && previewId) {
      const doc = await adminDb.collection('karigars').doc(previewId).get();
      if (!doc.exists) return NextResponse.json({ error: 'Karigar not found' }, { status: 404 });
      karigarId = doc.id;
      name = doc.data()?.name || 'Karigar';
    } else {
      const identity = await resolveKarigar(req);
      if (!identity) {
        return NextResponse.json({ role: owner ? 'owner' : 'none', karigar: null }, { status: owner ? 200 : 403 });
      }
      karigarId = identity.karigarId;
      name = identity.name;
    }

    const [ordersSnap, jobsSnap, hisaabSnap, expensesSnap] = await Promise.all([
      adminDb.collection('orders').get(),
      adminDb.collection('karigar_jobs').where('karigarId', '==', karigarId).get(),
      adminDb.collection('hisaab').where('entityId', '==', karigarId).get(),
      adminDb.collection('expenses').where('karigarId', '==', karigarId).get(),
    ]);

    type SafeJob = {
      id: string; source: 'order' | 'manual';
      description: string; category?: string; metalType?: string; karat?: string;
      weightG?: number; quantity?: number;
      size?: string; referenceSku?: string; sampleGiven?: boolean; sampleImage?: string; plating?: string;
      orderId?: string;
      status: 'pending' | 'in-progress' | 'completed';
      assignedDate: string; ageDays: number; urgency: 'ok' | 'warning' | 'critical';
      notes?: string;
    };
    const jobs: SafeJob[] = [];

    // ── Order-sourced work ── only this karigar's items, and only safe fields.
    for (const doc of ordersSnap.docs) {
      const o = doc.data() as Record<string, any>;
      if (o.status === 'Cancelled' || o.status === 'Refunded') continue;
      if (o.invoiceId) continue; // delivered
      if (o.status === 'Pending') continue; // not handed to the workshop yet
      const items = Array.isArray(o.items) ? o.items : [];
      items.forEach((item: Record<string, any>, idx: number) => {
        if (!item || item.karigarId !== karigarId) return;
        const done = !!item.isCompleted || o.status === 'Completed';
        const age = daysSince(o.createdAt);
        jobs.push({
          id: `order:${doc.id}:${idx}`,
          source: 'order',
          description: item.description || 'Item',
          category: categoryTitle(item.itemCategory) || undefined,
          metalType: item.metalType || undefined,
          // karat is meaningless on silver/platinum — the order form leaves a
          // default '21k' behind on every non-gold item
          karat: displayKarat(item.metalType, item.karat),
          weightG: typeof item.estimatedWeightG === 'number' ? item.estimatedWeightG : undefined,
          quantity: 1,
          size: item.size || undefined,
          referenceSku: item.referenceSku || undefined,
          sampleGiven: !!item.sampleGiven,
          sampleImage: item.sampleImageDataUri || undefined,
          plating: describePlating(item),
          status: done ? 'completed' : (o.status === 'In Progress' ? 'in-progress' : 'pending'),
          assignedDate: o.createdAt,
          ageDays: age,
          urgency: urgency(age, done),
          // stoneDetails / diamondDetails / adminNote all hold making notes;
          // merged so the karigar sees one instruction block, not three.
          notes: mergeInstructions(item),
          // The order reference is only a number — it lets a karigar quote a
          // job on the phone. Customer name, contact and every price are still
          // deliberately omitted.
          orderId: doc.id,
        });
      });
    }

    // ── Standalone jobs ──
    for (const doc of jobsSnap.docs) {
      const j = doc.data() as Record<string, any>;
      const age = daysSince(j.assignedDate);
      const done = j.status === 'completed';
      jobs.push({
        id: `job:${doc.id}`,
        source: 'manual',
        description: j.description || 'Work',
        category: categoryTitle(j.itemCategory) || j.itemCategory || undefined,
        metalType: j.metalType || undefined,
        karat: displayKarat(j.metalType, j.karat),
        weightG: typeof j.weightG === 'number' ? j.weightG : undefined,
        quantity: j.quantity ?? 1,
        size: j.size || undefined,
        status: j.status || 'pending',
        assignedDate: j.assignedDate,
        ageDays: age,
        urgency: urgency(age, done),
        notes: mergeInstructions(j),
      });
    }

    jobs.sort((a, b) => {
      if ((a.status === 'completed') !== (b.status === 'completed')) return a.status === 'completed' ? 1 : -1;
      return b.ageDays - a.ageDays;
    });

    // ── Their own account: gold in/out + cash paid ──
    let goldGiven = 0, goldReceived = 0;
    const ledger: { date: string; description: string; goldOut: number; goldIn: number }[] = [];
    for (const d of hisaabSnap.docs) {
      const h = d.data() as Record<string, any>;
      if (h.entityType !== 'karigar') continue;
      const out = Number(h.goldDebitGrams || 0);
      const inn = Number(h.goldCreditGrams || 0);
      goldGiven += out; goldReceived += inn;
      ledger.push({ date: h.date, description: h.description || '', goldOut: out, goldIn: inn });
    }
    ledger.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    let totalPaid = 0;
    const payments: { date: string; amount: number; description: string }[] = [];
    for (const d of expensesSnap.docs) {
      const e = d.data() as Record<string, any>;
      const amt = Number(e.amount || 0);
      totalPaid += amt;
      payments.push({ date: e.date || e.createdAt, amount: amt, description: e.description || '' });
    }
    payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const active = jobs.filter(j => j.status !== 'completed');

    return NextResponse.json({
      role: 'karigar',
      preview: owner && !!previewId,
      karigar: { id: karigarId, name },
      summary: {
        active: active.length,
        inProgress: active.filter(j => j.status === 'in-progress').length,
        late: active.filter(j => j.urgency === 'warning').length,
        critical: active.filter(j => j.urgency === 'critical').length,
        oldestDays: active.reduce((m, j) => Math.max(m, j.ageDays), 0),
      },
      jobs,
      account: {
        goldGiven: Number(goldGiven.toFixed(3)),
        goldReceived: Number(goldReceived.toFixed(3)),
        goldNet: Number((goldGiven - goldReceived).toFixed(3)),
        totalPaid,
        ledger: ledger.slice(0, 60),
        payments: payments.slice(0, 40),
      },
    });
  } catch (e: any) {
    console.error('[api/karigar/me]', e?.message);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
