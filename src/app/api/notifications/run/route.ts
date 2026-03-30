// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

function daysSince(isoDate: string) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString('en-PK');
}

async function getSettings() {
  const snap = await adminDb.collection('app_settings').limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
}

async function sendDailyChecklist(phone: string) {
  const [ordersSnap, givenSnap, batchesSnap] = await Promise.all([
    adminDb.collection('orders').get(),
    adminDb.collection('given_items').get(),
    adminDb.collection('karigar_batches').get(),
  ]);

  const orders  = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Array<Record<string, any>>;
  const given   = givenSnap.docs.map(d => d.data()) as Array<Record<string, any>>;
  const batches = batchesSnap.docs.map(d => d.data()) as Array<Record<string, any>>;

  const pending    = orders.filter(o => o.status === 'Pending');
  const inProgress = orders.filter(o => o.status === 'In Progress');
  const active     = [...pending, ...inProgress];
  const overdue7   = active.filter(o => daysSince(o.createdAt) >= 7).sort((a, b) => daysSince(b.createdAt) - daysSince(a.createdAt));
  const overdue14  = active.filter(o => daysSince(o.createdAt) >= 14);
  const fresh      = active.filter(o => daysSince(o.createdAt) < 7);

  const unreturnedAll = given.filter((g: Record<string, string>) => g.status === 'out');
  const unreturnedOld = unreturnedAll.filter((g: Record<string, string>) => daysSince(g.createdAt) >= 7);
  const unpaidBatches = batches.filter((b: Record<string, boolean>) => !b.paid);
  const unpaidTotal   = unpaidBatches.reduce((s: number, b: Record<string, number>) => s + Number(b.totalAmount || 0), 0);

  const date = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `💎 *MINA — Daily Checklist*`,
    `📅 ${date}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `📦 *ORDER PIPELINE*`,
    `  Total active: ${active.length}`,
    `  🟡 Pending: ${pending.length}`,
    `  🔵 In Progress: ${inProgress.length}`,
    `  🆕 Added this week: ${fresh.length}`,
    `  ⚠️  Overdue (7-14d): ${overdue7.length - overdue14.length}`,
    `  🔴 Critical (14d+): ${overdue14.length}`,
  ];

  if (overdue7.length > 0) {
    lines.push(``, `⚠️ *OVERDUE ORDERS — Needs Attention*`);
    overdue7.forEach(o => {
      const days = daysSince(o.createdAt);
      const flag = days >= 14 ? '🔴' : '⚠️';
      lines.push(`${flag} ${o.id} | ${o.customerName || 'Walk-in'} | ${days}d old | PKR ${fmt(Number(o.grandTotal))}`);
      if (o.summary) lines.push(`   └ ${o.summary}`);
    });
  }

  if (fresh.length > 0) {
    lines.push(``, `🆕 *ACTIVE ORDERS (< 7 days)*`);
    fresh.slice(0, 8).forEach(o => {
      lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | ${daysSince(o.createdAt)}d | PKR ${fmt(Number(o.grandTotal))}`);
    });
    if (fresh.length > 8) lines.push(`  … and ${fresh.length - 8} more`);
  }

  if (unreturnedAll.length > 0) {
    lines.push(``, `📤 *GIVEN ITEMS OUT*`);
    lines.push(`  Total out: ${unreturnedAll.length} | Overdue (7d+): ${unreturnedOld.length}`);
    unreturnedOld.slice(0, 5).forEach((g: Record<string, string>) => {
      lines.push(`  🔴 ${g.description || g.id} — ${daysSince(g.createdAt)} days`);
    });
  }

  if (unpaidBatches.length > 0) {
    lines.push(``, `💸 *KARIGAR PAYMENTS DUE*`);
    lines.push(`  ${unpaidBatches.length} unpaid batch(es) — PKR ${fmt(unpaidTotal)}`);
    unpaidBatches.slice(0, 3).forEach((b: Record<string, string | number>) => {
      lines.push(`  • ${b.karigarName || b.karigarId} — PKR ${fmt(Number(b.totalAmount))}`);
    });
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━`, `Have a productive day! 💎`);
  await sendWhatsAppMessage(phone, lines.join('\n'));
}

async function sendEndOfDaySummary(phone: string) {
  const [ordersSnap, expensesSnap] = await Promise.all([
    adminDb.collection('orders').get(),
    adminDb.collection('expenses').get(),
  ]);

  const orders   = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const expenses = expensesSnap.docs.map(d => d.data());
  const today    = new Date().toDateString();

  const createdToday   = orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const completedToday = orders.filter(o => o.status === 'Completed' && new Date(o.updatedAt || o.createdAt).toDateString() === today);
  const expToday       = expenses.filter((e: Record<string, string>) => new Date(e.date || e.createdAt).toDateString() === today);
  const expTotalToday  = expToday.reduce((s: number, e: Record<string, number>) => s + Number(e.amount || 0), 0);
  const revToday       = completedToday.reduce((s: number, o: Record<string, number>) => s + Number(o.grandTotal || 0), 0);
  const active         = orders.filter(o => o.status === 'Pending' || o.status === 'In Progress');

  const date = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `🌙 *MINA — End of Day*`,
    `📅 ${date}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `📊 *TODAY'S SUMMARY*`,
    `  📝 New orders: ${createdToday.length}`,
    `  ✅ Completed: ${completedToday.length}`,
    `  💰 Revenue from completed: PKR ${fmt(revToday)}`,
    `  💸 Expenses logged: PKR ${fmt(expTotalToday)}`,
  ];

  if (createdToday.length > 0) {
    lines.push(``, `📝 *ORDERS CREATED TODAY*`);
    createdToday.forEach(o => {
      lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | PKR ${fmt(Number(o.grandTotal))}`);
      if (o.summary) lines.push(`   └ ${o.summary}`);
    });
  }

  if (completedToday.length > 0) {
    lines.push(``, `✅ *COMPLETED TODAY*`);
    completedToday.forEach(o => {
      lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | PKR ${fmt(Number(o.grandTotal))}`);
    });
  }

  lines.push(
    ``,
    `📦 *PIPELINE STATUS*`,
    `  Active orders remaining: ${active.length}`,
    `  Overdue (7d+): ${active.filter(o => daysSince(o.createdAt) >= 7).length}`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `Good night! Rest well. 🌙`
  );

  await sendWhatsAppMessage(phone, lines.join('\n'));
}

async function sendWeeklyReport(phone: string) {
  const [ordersSnap, expensesSnap, batchesSnap, givenSnap] = await Promise.all([
    adminDb.collection('orders').get(),
    adminDb.collection('expenses').get(),
    adminDb.collection('karigar_batches').get(),
    adminDb.collection('given_items').get(),
  ]);

  const orders   = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const expenses = expensesSnap.docs.map(d => d.data());
  const batches  = batchesSnap.docs.map(d => d.data());
  const given    = givenSnap.docs.map(d => d.data());

  const now     = Date.now();
  const weekAgo = now - 7 * 86400000;

  const newThisWeek     = orders.filter(o => new Date(o.createdAt).getTime() >= weekAgo);
  const completedAll    = orders.filter(o => o.status === 'Completed');
  const doneThisWeek    = orders.filter(o => o.status === 'Completed' && new Date(o.createdAt).getTime() >= weekAgo);
  const cancelledThisWeek = orders.filter(o => (o.status === 'Cancelled' || o.status === 'Refunded') && new Date(o.createdAt).getTime() >= weekAgo);
  const active          = orders.filter(o => o.status === 'Pending' || o.status === 'In Progress');
  const overdue7        = active.filter(o => daysSince(o.createdAt) >= 7);
  const overdue14       = active.filter(o => daysSince(o.createdAt) >= 14);

  const expThisWeek  = expenses.filter((e: Record<string, string>) => new Date(e.date || e.createdAt).getTime() >= weekAgo);
  const totalExp     = expThisWeek.reduce((s: number, e: Record<string, number>) => s + Number(e.amount || 0), 0);
  const totalRev     = doneThisWeek.reduce((s: number, o: Record<string, number>) => s + Number(o.grandTotal || 0), 0);
  const newOrdersVal = newThisWeek.reduce((s: number, o: Record<string, number>) => s + Number(o.grandTotal || 0), 0);
  const netProfit    = totalRev - totalExp;

  // Expense breakdown by category
  const expByCategory: Record<string, number> = {};
  expThisWeek.forEach((e: Record<string, string | number>) => {
    const cat = String(e.category || 'Other');
    expByCategory[cat] = (expByCategory[cat] || 0) + Number(e.amount || 0);
  });

  const unpaidBatches = batches.filter((b: Record<string, boolean>) => !b.paid);
  const unpaidTotal   = unpaidBatches.reduce((s: number, b: Record<string, number>) => s + Number(b.totalAmount || 0), 0);
  const unreturnedGiven = given.filter((g: Record<string, string>) => g.status === 'out');

  const weekStart = new Date(weekAgo).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
  const weekEnd   = new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `📊 *MINA — Weekly Report*`,
    `📅 ${weekStart} – ${weekEnd}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `💼 *ORDERS THIS WEEK*`,
    `  📝 New orders: ${newThisWeek.length} (PKR ${fmt(newOrdersVal)})`,
    `  ✅ Completed: ${doneThisWeek.length} (PKR ${fmt(totalRev)})`,
    `  ❌ Cancelled/Refunded: ${cancelledThisWeek.length}`,
    `  📦 Total active pipeline: ${active.length}`,
    ``,
    `💰 *FINANCIALS*`,
    `  Revenue (completed): PKR ${fmt(totalRev)}`,
    `  Expenses: PKR ${fmt(totalExp)}`,
    `  Net: PKR ${fmt(netProfit)} ${netProfit >= 0 ? '✅' : '🔴'}`,
  ];

  if (Object.keys(expByCategory).length > 0) {
    lines.push(``, `💸 *EXPENSE BREAKDOWN*`);
    Object.entries(expByCategory)
      .sort(([, a], [, b]) => b - a)
      .forEach(([cat, amt]) => lines.push(`  • ${cat}: PKR ${fmt(amt)}`));
  }

  if (doneThisWeek.length > 0) {
    lines.push(``, `✅ *COMPLETED ORDERS*`);
    doneThisWeek.forEach(o => {
      lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | PKR ${fmt(Number(o.grandTotal))}`);
    });
  }

  lines.push(``, `📦 *PIPELINE HEALTH*`);
  lines.push(`  On track (< 7d): ${active.filter(o => daysSince(o.createdAt) < 7).length}`);
  lines.push(`  Overdue 7-14d: ${overdue7.length - overdue14.length}`);
  lines.push(`  Critical 14d+: ${overdue14.length}`);

  if (overdue7.length > 0) {
    lines.push(``, `⚠️ *OVERDUE ORDERS*`);
    overdue7.sort((a, b) => daysSince(b.createdAt) - daysSince(a.createdAt)).forEach(o => {
      lines.push(`${daysSince(o.createdAt) >= 14 ? '🔴' : '⚠️'} ${o.id} | ${o.customerName || 'Walk-in'} | ${daysSince(o.createdAt)}d | PKR ${fmt(Number(o.grandTotal))}`);
    });
  }

  if (unpaidBatches.length > 0) {
    lines.push(``, `💸 *KARIGAR PAYMENTS OUTSTANDING*`);
    lines.push(`  ${unpaidBatches.length} batch(es) — PKR ${fmt(unpaidTotal)}`);
    unpaidBatches.forEach((b: Record<string, string | number>) => {
      lines.push(`  • ${b.karigarName || b.karigarId} — PKR ${fmt(Number(b.totalAmount))}`);
    });
  } else {
    lines.push(``, `✅ All karigar batches paid`);
  }

  if (unreturnedGiven.length > 0) {
    lines.push(``, `📤 *ITEMS STILL OUT* — ${unreturnedGiven.length} total`);
    unreturnedGiven.slice(0, 5).forEach((g: Record<string, string>) => {
      const days = daysSince(g.createdAt);
      lines.push(`  ${days >= 7 ? '🔴' : '•'} ${g.description || g.id} — ${days}d`);
    });
  }

  lines.push(
    ``,
    `📈 *ALL-TIME STATS*`,
    `  Total completed orders: ${completedAll.length}`,
    `  Total active: ${active.length}`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `Have a great week ahead! 💎`
  );

  await sendWhatsAppMessage(phone, lines.join('\n'));
}

async function checkOverdueOrders(phone: string) {
  const snap = await adminDb.collection('orders').get();
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const overdue = orders
    .filter(o => (o.status === 'Pending' || o.status === 'In Progress') && daysSince(o.createdAt) >= 7)
    .sort((a, b) => daysSince(b.createdAt) - daysSince(a.createdAt));

  if (overdue.length === 0) return;

  const critical = overdue.filter(o => daysSince(o.createdAt) >= 14);
  const warning  = overdue.filter(o => daysSince(o.createdAt) < 14);

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `⚠️ *OVERDUE ORDERS ALERT*`,
    `${overdue.length} order(s) need attention`,
    `━━━━━━━━━━━━━━━━━━`,
  ];

  if (critical.length > 0) {
    lines.push(``, `🔴 *CRITICAL (14+ days)*`);
    critical.forEach(o => {
      lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | ${daysSince(o.createdAt)} days | PKR ${fmt(Number(o.grandTotal))}`);
      if (o.summary) lines.push(`   └ ${o.summary}`);
    });
  }

  if (warning.length > 0) {
    lines.push(``, `⚠️ *WARNING (7-14 days)*`);
    warning.forEach(o => {
      lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | ${daysSince(o.createdAt)} days | PKR ${fmt(Number(o.grandTotal))}`);
      if (o.summary) lines.push(`   └ ${o.summary}`);
    });
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━`);
  await sendWhatsAppMessage(phone, lines.join('\n'));
}

async function checkGivenItems(phone: string) {
  const snap = await adminDb.collection('given_items').get();
  const items = snap.docs.map(d => d.data());
  const allOut = items.filter(g => g.status === 'out');
  const old    = allOut.filter(g => daysSince(g.createdAt) >= 7).sort((a: Record<string, string>, b: Record<string, string>) => daysSince(b.createdAt) - daysSince(a.createdAt));

  if (old.length === 0) return;

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `📤 *GIVEN ITEMS OVERDUE*`,
    `${old.length} item(s) not returned (7+ days)`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
  ];

  old.forEach((g: Record<string, string>) => {
    const days = daysSince(g.createdAt);
    lines.push(`${days >= 14 ? '🔴' : '⚠️'} ${g.description || g.id}`);
    lines.push(`   Given: ${new Date(g.createdAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })} — ${days} days ago`);
    if (g.givenTo) lines.push(`   To: ${g.givenTo}`);
  });

  lines.push(``, `Total items out: ${allOut.length}`, `━━━━━━━━━━━━━━━━━━`);
  await sendWhatsAppMessage(phone, lines.join('\n'));
}

async function checkKarigarPayments(phone: string) {
  const snap = await adminDb.collection('karigar_batches').get();
  const batches = snap.docs.map(d => d.data());
  const unpaid  = batches.filter((b: Record<string, boolean>) => !b.paid);
  if (unpaid.length === 0) return;

  const total = unpaid.reduce((s: number, b: Record<string, number>) => s + Number(b.totalAmount || 0), 0);

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `💸 *KARIGAR PAYMENTS DUE*`,
    `${unpaid.length} unpaid batch(es)`,
    `Total outstanding: PKR ${fmt(total)}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
  ];

  unpaid.forEach((b: Record<string, string | number>) => {
    lines.push(`• *${b.karigarName || b.karigarId}*`);
    lines.push(`  Amount: PKR ${fmt(Number(b.totalAmount))}`);
    if (b.createdAt) lines.push(`  Since: ${new Date(String(b.createdAt)).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })}`);
  });

  lines.push(``, `━━━━━━━━━━━━━━━━━━`);
  await sendWhatsAppMessage(phone, lines.join('\n'));
}

export async function POST(req: NextRequest) {
  try {
    const { task, force } = await req.json();
    const s = await getSettings();

    if (!s?.notifEnabled || !s?.notifPhones?.length) {
      return NextResponse.json({ skipped: 'Notifications disabled or no recipients', settings: { notifEnabled: s?.notifEnabled, phones: s?.notifPhones } });
    }

    const phones: string[] = s.notifPhones;

    for (const phone of phones) {
      switch (task) {
        case 'daily-checklist':  if (force || s.notifDailyChecklist)  await sendDailyChecklist(phone);  break;
        case 'end-of-day':       if (force || s.notifEndOfDay)         await sendEndOfDaySummary(phone); break;
        case 'weekly-report':    if (force || s.notifWeeklyReport)     await sendWeeklyReport(phone);    break;
        case 'overdue-orders':   if (force || s.notifOrderOverdue)     await checkOverdueOrders(phone);  break;
        case 'given-items':      if (force || s.notifGivenItems)       await checkGivenItems(phone);     break;
        case 'karigar-payments': if (force || s.notifKarigarPayment)   await checkKarigarPayments(phone);break;
        default:
          return NextResponse.json({ error: `Unknown task: ${task}` }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true, task, recipients: phones.length, forced: !!force });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/notifications/run]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
