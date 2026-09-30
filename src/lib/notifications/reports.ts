/**
 * The WhatsApp reports' words, each read fresh from Firestore: the morning checklist, the
 * end-of-day recap, the nightly report, the weekly report and the three overdue checks.
 * Each returns the message, or null when there is nothing to say; dispatch.ts sends it.
 * (Moved out of /api/notifications/run, which sent one copy per number and so read every
 * order, invoice and expense once for each.)
 */
import { adminDb } from '@/lib/firebase-admin';
import { isBusinessCost } from '@/lib/partnership';
import { lateOrders, orderTiming, timingLabel } from '@/lib/order-timing';
// These reports go to the shop's own staff, so they must carry the shop's own name.
// They were hardcoded to MINA from the repo this was based on.
import { STORE_CONFIG } from '@/lib/store-config';
import { fromThisPos } from '@/lib/notify-label';  // the owner gets both houses' reports
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
const SHOP = STORE_CONFIG.name.toUpperCase();

/** A Firestore document as read: the reports only format what they find. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * What the shop sold between two times, as Analytics counts it: invoices, refunds left out,
 * each at its sale value (exchange gold is payment — lib/analytics/sale-value.ts). These
 * reports used to count completed orders' totals, which left out every counter sale.
 */
function salesBetween(invoices: Row[], from: number, to = Infinity): { count: number; value: number; list: Row[] } {
  const list = invoices.filter(i => {
    const t = new Date(i.createdAt).getTime();
    return i.status !== 'Refunded' && t >= from && t < to;
  });
  return { count: list.length, value: list.reduce((s, i) => s + saleValue(i), 0), list };
}
const saleValue = (i: Row) => invoiceSaleValue(i as Parameters<typeof invoiceSaleValue>[0]);

/**
 * Orders finished from a time on, each with the invoice it became. An order keeps no date of
 * its own for that (no updatedAt, no completedAt), so "completed today" used to mean "taken
 * today and since completed"; the invoice's date is when it was finished. Needs invoice ids.
 */
function completedSince(orders: Row[], invoices: Row[], from: number): { order: Row; invoice: Row }[] {
  const byId = new Map(invoices.map(i => [i.id, i]));
  const byOrder = new Map(invoices.filter(i => i.sourceOrderId).map(i => [i.sourceOrderId, i]));
  return orders.flatMap(order => {
    if (order.status !== 'Completed') return [];
    const invoice = (order.invoiceId && byId.get(order.invoiceId)) || byOrder.get(order.id);
    return invoice && new Date(invoice.createdAt).getTime() >= from ? [{ order, invoice }] : [];
  });
}

/** Active orders past the date the customer was promised (order-timing.ts), as the checklist counts them. */
const lateActive = (orders: Row[], now = new Date()) =>
  lateOrders(orders as Array<Row & Parameters<typeof lateOrders>[0][number]>, now);

/**
 * Each karigar's balance from Hisaab, added up as the Hisaab page does: cash (+ they owe the
 * shop, − the shop owes them) and gold (+ the shop's gold with them). Karigar batches were read
 * here before, but a batch is only a period ("April 2026") with no amount and no paid flag, so
 * every one read as "unpaid, PKR 0".
 */
async function karigarBalances(): Promise<{ name: string; cash: number; gold: number }[]> {
  const snap = await adminDb.collection('hisaab').where('entityType', '==', 'karigar').get();
  const by = new Map<string, { name: string; cash: number; gold: number }>();
  for (const d of snap.docs) {
    const e = d.data() as Row;
    if (!e.entityId) continue;
    const b = by.get(e.entityId) ?? { name: e.entityName || e.entityId, cash: 0, gold: 0 };
    b.cash += Number(e.cashDebit || 0) - Number(e.cashCredit || 0);
    b.gold += Number(e.goldDebitGrams || 0) - Number(e.goldCreditGrams || 0);
    by.set(e.entityId, b);
  }
  return [...by.values()].filter(b => Math.abs(b.cash) >= 1 || Math.abs(b.gold) >= 0.01);
}
const grams = (g: number) => `${Math.abs(g).toFixed(2)} g`;

function daysSince(isoDate: string) {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

/** Whole rupees: order totals carry half-rupees from the wastage and rate maths. */
function fmt(n: number) {
  return Math.round(Number(n || 0)).toLocaleString('en-PK');
}

async function buildDailyChecklist(): Promise<string | null> {
  const [ordersSnap, givenSnap, karigars] = await Promise.all([
    adminDb.collection('orders').get(),
    adminDb.collection('given_items').get(),
    karigarBalances(),
  ]);

  const orders  = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const given   = givenSnap.docs.map(d => d.data() as Row);

  const pending    = orders.filter(o => o.status === 'Pending');
  const inProgress = orders.filter(o => o.status === 'In Progress');
  const active     = [...pending, ...inProgress];
  // Late now means past the date the customer was promised, not simply old.
  // Orders taken before promisedDate existed keep the old age rule; see
  // orderTiming(). `estimated` marks which of the two produced the verdict so
  // the message can be honest about it.
  const now       = new Date();
  const late      = lateOrders(active as Array<Row & Parameters<typeof lateOrders>[0][number]>, now);
  const lateBad   = late.filter(x => x.timing.daysLate >= 7);
  const onTrack   = active.filter(o => !late.some(x => x.order === o));

  const unreturnedAll = given.filter((g: Record<string, string>) => g.status === 'out');
  const unreturnedOld = unreturnedAll.filter((g: Record<string, string>) => daysSince(g.date) >= 7);
  const toPay         = karigars.filter(k => k.cash < 0).sort((a, b) => a.cash - b.cash);

  const date = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `💎 *${SHOP} — Daily Checklist*`,
    `📅 ${date}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `📦 *ORDER PIPELINE*`,
    `  Total active: ${active.length}`,
    `  🟡 Pending: ${pending.length}`,
    `  🔵 In Progress: ${inProgress.length}`,
    `  🟢 On track: ${onTrack.length}`,
    `  ⚠️  Late: ${late.length - lateBad.length}`,
    `  🔴 A week or more late: ${lateBad.length}`,
  ];

  if (late.length > 0) {
    lines.push(``, `⚠️ *PAST THE PROMISED DATE*`);
    late.forEach(({ order: o, timing }) => {
      const flag = timing.daysLate >= 7 ? '🔴' : '⚠️';
      lines.push(`${flag} ${o.id} | ${o.customerName || 'Walk-in'} | ${timingLabel(timing)} | PKR ${fmt(Number(o.grandTotal))}`);
      if (o.summary) lines.push(`   └ ${o.summary}`);
    });
    if (late.some(x => x.timing.estimated)) {
      lines.push(`   ("old" = no promised date on record, counted from when it was taken)`);
    }
  }

  if (onTrack.length > 0) {
    lines.push(``, `🆕 *ON TRACK*`);
    onTrack.slice(0, 8).forEach(o => {
      const t = orderTiming(o as unknown as Parameters<typeof orderTiming>[0], now);
      lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | ${timingLabel(t) || `${daysSince(o.createdAt)}d`} | PKR ${fmt(Number(o.grandTotal))}`);
    });
    if (onTrack.length > 8) lines.push(`  … and ${onTrack.length - 8} more`);
  }

  if (unreturnedAll.length > 0) {
    lines.push(``, `📤 *GIVEN ITEMS OUT*`);
    lines.push(`  Total out: ${unreturnedAll.length} | Overdue (7d+): ${unreturnedOld.length}`);
    unreturnedOld.slice(0, 5).forEach((g: Record<string, string>) => {
      lines.push(`  🔴 ${g.description || g.id} — ${daysSince(g.date)} days`);
    });
  }

  if (toPay.length > 0) {
    lines.push(``, `💸 *TO PAY KARIGARS (HISAAB)*`);
    lines.push(`  PKR ${fmt(toPay.reduce((s, k) => s - k.cash, 0))} to ${toPay.length}`);
    toPay.slice(0, 3).forEach(k => lines.push(`  • ${k.name} — PKR ${fmt(-k.cash)}`));
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━`, `Have a productive day! 💎`);
  return fromThisPos(lines.join('\n'));
}

async function buildEndOfDaySummary(): Promise<string | null> {
  const [ordersSnap, expensesSnap, invoicesSnap] = await Promise.all([
    adminDb.collection('orders').get(),
    adminDb.collection('expenses').get(),
    adminDb.collection('invoices').get(),
  ]);

  const orders   = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const expenses = expensesSnap.docs.map(d => d.data() as Row);
  const invoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const today    = new Date().toDateString();
  const midnight = new Date(today).getTime();
  const sold     = salesBetween(invoices, midnight);

  const createdToday   = orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const completedToday = completedSince(orders, invoices, midnight);
  const expToday       = expenses.filter((e: Record<string, string>) => new Date(e.date || e.createdAt).toDateString() === today);
  const expTotalToday  = expToday.reduce((s: number, e: Record<string, number>) => s + Number(e.amount || 0), 0);
  const active         = orders.filter(o => o.status === 'Pending' || o.status === 'In Progress');

  const date = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long' });

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `🌙 *${SHOP} — End of Day*`,
    `📅 ${date}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `📊 *TODAY'S SUMMARY*`,
    `  📝 New orders: ${createdToday.length}`,
    `  ✅ Completed: ${completedToday.length}`,
    `  🧾 Sales: ${sold.count} (PKR ${fmt(sold.value)})`,
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
    completedToday.forEach(({ order: o, invoice }) => {
      lines.push(`• ${o.id} → ${invoice.id} | ${o.customerName || 'Walk-in'} | PKR ${fmt(saleValue(invoice))}`);
    });
  }

  lines.push(
    ``,
    `📦 *PIPELINE STATUS*`,
    `  Active orders remaining: ${active.length}`,
    `  Past their date: ${lateActive(active).length}`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `Good night! Rest well. 🌙`
  );

  return fromThisPos(lines.join('\n'));
}

async function buildDailyReport(): Promise<string | null> {
  const [ordersSnap, invoicesSnap, expensesSnap] = await Promise.all([
    adminDb.collection('orders').get(),
    adminDb.collection('invoices').get(),
    adminDb.collection('expenses').get(),
  ]);

  const orders   = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const invoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const expenses = expensesSnap.docs.map(d => d.data() as Row);
  const today    = new Date().toDateString();

  // ── Invoices / sales ──
  const { list: invoicesToday, value: salesTotalToday } = salesBetween(invoices, new Date(today).getTime());

  // Cash collected today = payment-history entries dated today across ALL invoices
  let cashInToday = 0;
  const paymentsToday: Array<{ id: string; customer: string; amount: number }> = [];
  for (const inv of invoices) {
    const history = Array.isArray(inv.paymentHistory) ? inv.paymentHistory : [];
    for (const p of history) {
      if (p?.date && new Date(p.date).toDateString() === today) {
        const amt = Number(p.amount || 0);
        cashInToday += amt;
        if (amt > 0) paymentsToday.push({ id: inv.id, customer: inv.customerName || 'Walk-in', amount: amt });
      }
    }
  }

  const outstanding = invoices.filter(i => i.status !== 'Refunded' && Number(i.balanceDue || 0) > 0);
  const outstandingTotal = outstanding.reduce((s, i) => s + Number(i.balanceDue || 0), 0);

  // ── Orders ──
  const createdToday   = orders.filter(o => new Date(o.createdAt).toDateString() === today);
  const completedToday = completedSince(orders, invoices, new Date(today).getTime());
  const active         = orders.filter(o => o.status === 'Pending' || o.status === 'In Progress');
  const late           = lateActive(active);

  // ── Expenses ──
  const expToday      = expenses.filter(e => new Date(e.date || e.createdAt).toDateString() === today);
  const expTotalToday = expToday.reduce((s, e) => s + Number(e.amount || 0), 0);

  const netCashToday = cashInToday - expTotalToday;
  const date = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `💎 *${SHOP} — Daily Report*`,
    `📅 ${date}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `🧾 *SALES TODAY*`,
    `  Invoices: ${invoicesToday.length}`,
    `  Sales value: PKR ${fmt(salesTotalToday)}`,
    `  💵 Cash collected: PKR ${fmt(cashInToday)}`,
    `  💸 Expenses: PKR ${fmt(expTotalToday)}`,
    `  📈 Net cash: PKR ${fmt(netCashToday)} ${netCashToday >= 0 ? '✅' : '🔴'}`,
  ];

  if (invoicesToday.length > 0) {
    lines.push(``, `🧾 *INVOICES CREATED*`);
    invoicesToday.forEach(i => {
      const bal = Number(i.balanceDue || 0);
      const tag = bal > 0 ? `⚠️ bal PKR ${fmt(bal)}` : `✅ paid`;
      lines.push(`• ${i.id} | ${i.customerName || 'Walk-in'} | PKR ${fmt(saleValue(i))} | ${tag}`);
    });
  }

  if (paymentsToday.length > 0) {
    lines.push(``, `💰 *PAYMENTS RECEIVED*`);
    paymentsToday.forEach(p => lines.push(`• ${p.id} | ${p.customer} | PKR ${fmt(p.amount)}`));
  }

  lines.push(
    ``,
    `📦 *ORDERS TODAY*`,
    `  📝 New: ${createdToday.length}`,
    `  ✅ Completed: ${completedToday.length}`,
  );
  if (createdToday.length > 0) {
    createdToday.forEach(o => lines.push(`• ${o.id} | ${o.customerName || 'Walk-in'} | PKR ${fmt(Number(o.grandTotal))}`));
  }

  lines.push(
    ``,
    `📊 *OUTSTANDING & PIPELINE*`,
    `  Unpaid invoices: ${outstanding.length} | PKR ${fmt(outstandingTotal)}`,
    `  Active orders: ${active.length} | Past their date: ${late.length}`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `Good night! 🌙`,
  );

  return fromThisPos(lines.join('\n'));
}

async function buildWeeklyReport(): Promise<string | null> {
  const [ordersSnap, expensesSnap, invoicesSnap, givenSnap, karigars] = await Promise.all([
    adminDb.collection('orders').get(),
    adminDb.collection('expenses').get(),
    adminDb.collection('invoices').get(),
    adminDb.collection('given_items').get(),
    karigarBalances(),
  ]);

  const orders   = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const expenses = expensesSnap.docs.map(d => d.data() as Row);
  const invoices = invoicesSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const given    = givenSnap.docs.map(d => d.data() as Row);

  const now     = Date.now();
  const weekAgo = now - 7 * 86400000;

  const newThisWeek     = orders.filter(o => new Date(o.createdAt).getTime() >= weekAgo);
  const completedAll    = orders.filter(o => o.status === 'Completed');
  const doneThisWeek    = completedSince(orders, invoices, weekAgo);
  const cancelledThisWeek = orders.filter(o => (o.status === 'Cancelled' || o.status === 'Refunded') && new Date(o.createdAt).getTime() >= weekAgo);
  const active          = orders.filter(o => o.status === 'Pending' || o.status === 'In Progress');
  const late            = lateActive(active);
  const lateBad         = late.filter(x => x.timing.daysLate >= 7);

  // Business costs only: a partner's draw is not a cost of the week's trade (with a
  // 50/50 split it would otherwise charge the other partner for half of it).
  const expThisWeek  = expenses.filter((e: Record<string, string>) =>
    new Date(e.date || e.createdAt).getTime() >= weekAgo && isBusinessCost(e));
  const totalExp     = expThisWeek.reduce((s: number, e: Record<string, number>) => s + Number(e.amount || 0), 0);
  const doneVal      = doneThisWeek.reduce((s, d) => s + saleValue(d.invoice), 0);
  const newOrdersVal = newThisWeek.reduce((s: number, o: Record<string, number>) => s + Number(o.grandTotal || 0), 0);
  const sold         = salesBetween(invoices, weekAgo);
  // Not profit — the metal and the karigars' work are not in it — so it is not called that.
  const net          = sold.value - totalExp;

  // Expense breakdown by category
  const expByCategory: Record<string, number> = {};
  expThisWeek.forEach((e: Record<string, string | number>) => {
    const cat = String(e.category || 'Other');
    expByCategory[cat] = (expByCategory[cat] || 0) + Number(e.amount || 0);
  });

  const toPay    = karigars.filter(k => k.cash < 0);
  const goldWith = karigars.filter(k => k.gold > 0);
  const unreturnedGiven = given.filter((g: Record<string, string>) => g.status === 'out');

  const weekStart = new Date(weekAgo).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
  const weekEnd   = new Date().toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `📊 *${SHOP} — Weekly Report*`,
    `📅 ${weekStart} – ${weekEnd}`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `💼 *ORDERS THIS WEEK*`,
    `  📝 New orders: ${newThisWeek.length} (PKR ${fmt(newOrdersVal)})`,
    `  ✅ Completed: ${doneThisWeek.length} (PKR ${fmt(doneVal)})`,
    `  ❌ Cancelled/Refunded: ${cancelledThisWeek.length}`,
    `  📦 Total active pipeline: ${active.length}`,
    ``,
    `💰 *MONEY*`,
    `  Sales: ${sold.count} invoice(s), PKR ${fmt(sold.value)}`,
    `  Expenses: PKR ${fmt(totalExp)}`,
    `  Sales less expenses: PKR ${fmt(net)} ${net >= 0 ? '✅' : '🔴'}`,
  ];

  if (Object.keys(expByCategory).length > 0) {
    lines.push(``, `💸 *EXPENSE BREAKDOWN*`);
    Object.entries(expByCategory)
      .sort(([, a], [, b]) => b - a)
      .forEach(([cat, amt]) => lines.push(`  • ${cat}: PKR ${fmt(amt)}`));
  }

  if (doneThisWeek.length > 0) {
    lines.push(``, `✅ *COMPLETED ORDERS*`);
    doneThisWeek.forEach(({ order: o, invoice }) => {
      lines.push(`• ${o.id} → ${invoice.id} | ${o.customerName || 'Walk-in'} | PKR ${fmt(saleValue(invoice))}`);
    });
  }

  lines.push(``, `📦 *PIPELINE HEALTH*`);
  lines.push(`  On track: ${active.length - late.length}`);
  lines.push(`  Past their date: ${late.length - lateBad.length}`);
  lines.push(`  A week or more late: ${lateBad.length}`);

  if (late.length > 0) {
    lines.push(``, `⚠️ *PAST THE PROMISED DATE*`);
    [...late].sort((a, b) => b.timing.daysLate - a.timing.daysLate).forEach(({ order: o, timing }) => {
      lines.push(`${timing.daysLate >= 7 ? '🔴' : '⚠️'} ${o.id} | ${o.customerName || 'Walk-in'} | ${timingLabel(timing)} | PKR ${fmt(Number(o.grandTotal))}`);
    });
  }

  if (toPay.length || goldWith.length) {
    lines.push(``, `🔨 *KARIGARS (HISAAB)*`);
    if (toPay.length) lines.push(`  To pay: PKR ${fmt(toPay.reduce((s, k) => s - k.cash, 0))} to ${toPay.length}`);
    if (goldWith.length) lines.push(`  Gold with them: ${grams(goldWith.reduce((s, k) => s + k.gold, 0))} across ${goldWith.length}`);
  }

  if (unreturnedGiven.length > 0) {
    lines.push(``, `📤 *ITEMS STILL OUT* — ${unreturnedGiven.length} total`);
    unreturnedGiven.slice(0, 5).forEach((g: Record<string, string>) => {
      const days = daysSince(g.date);
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

  return fromThisPos(lines.join('\n'));
}

async function buildOverdueOrders(): Promise<string | null> {
  const snap = await adminDb.collection('orders').get();
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Row);
  const late = lateOrders(orders as Array<Row & Parameters<typeof lateOrders>[0][number]>, new Date());

  if (late.length === 0) return null;

  // A week past what was promised is a different conversation from a day past.
  const critical = late.filter(x => x.timing.daysLate >= 7);
  const warning  = late.filter(x => x.timing.daysLate < 7);

  const row = ({ order: o, timing }: (typeof late)[number]) =>
    `• ${o.id} | ${o.customerName || 'Walk-in'} | ${timingLabel(timing)} | PKR ${fmt(Number(o.grandTotal))}`;

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `⚠️ *ORDERS PAST THEIR DATE*`,
    `${late.length} order(s) need attention`,
    `━━━━━━━━━━━━━━━━━━`,
  ];

  if (critical.length > 0) {
    lines.push(``, `🔴 *A WEEK OR MORE LATE*`);
    critical.forEach(x => {
      lines.push(row(x));
      if (x.order.summary) lines.push(`   └ ${x.order.summary}`);
    });
  }

  if (warning.length > 0) {
    lines.push(``, `⚠️ *JUST LATE*`);
    warning.forEach(x => {
      lines.push(row(x));
      if (x.order.summary) lines.push(`   └ ${x.order.summary}`);
    });
  }

  if (late.some(x => x.timing.estimated)) {
    lines.push(``, `"old" means no promised date was recorded — counted from when the order was taken.`);
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━`);
  return fromThisPos(lines.join('\n'));
}

async function buildGivenItems(): Promise<string | null> {
  const snap = await adminDb.collection('given_items').get();
  const items = snap.docs.map(d => d.data() as Row);
  const allOut = items.filter(g => g.status === 'out');
  const old    = allOut.filter(g => daysSince(g.date) >= 7).sort((a: Record<string, string>, b: Record<string, string>) => daysSince(b.date) - daysSince(a.date));

  if (old.length === 0) return null;

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `📤 *GIVEN ITEMS OVERDUE*`,
    `${old.length} item(s) not returned (7+ days)`,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
  ];

  old.forEach((g: Record<string, string>) => {
    const days = daysSince(g.date);
    lines.push(`${days >= 14 ? '🔴' : '⚠️'} ${g.description || g.id}`);
    lines.push(`   Given: ${new Date(g.date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })} — ${days} days ago`);
    if (g.recipientName) lines.push(`   To: ${g.recipientName}`);
  });

  lines.push(``, `Total items out: ${allOut.length}`, `━━━━━━━━━━━━━━━━━━`);
  return fromThisPos(lines.join('\n'));
}

async function buildKarigarPayments(): Promise<string | null> {
  const karigars = await karigarBalances();
  if (!karigars.length) return null;
  const toPay   = karigars.filter(k => k.cash < 0).sort((x, y) => x.cash - y.cash);
  const toGet   = karigars.filter(k => k.cash > 0).sort((x, y) => y.cash - x.cash);
  const goldOut = karigars.filter(k => k.gold > 0).sort((x, y) => y.gold - x.gold);
  const goldIn  = karigars.filter(k => k.gold < 0).sort((x, y) => x.gold - y.gold);

  const lines = [
    `━━━━━━━━━━━━━━━━━━`,
    `🔨 *KARIGAR BALANCES*`,
    `From Hisaab, as each karigar's page shows it`,
    `━━━━━━━━━━━━━━━━━━`,
  ];
  if (toPay.length) {
    lines.push(``, `💸 *TO PAY: PKR ${fmt(toPay.reduce((s, k) => s - k.cash, 0))}*`);
    toPay.forEach(k => lines.push(`• ${k.name} — PKR ${fmt(-k.cash)}`));
  }
  if (toGet.length) {
    lines.push(``, `💵 *TO RECEIVE: PKR ${fmt(toGet.reduce((s, k) => s + k.cash, 0))}*`);
    toGet.forEach(k => lines.push(`• ${k.name} — PKR ${fmt(k.cash)}`));
  }
  if (goldOut.length) {
    lines.push(``, `🟡 *GOLD WITH KARIGARS: ${grams(goldOut.reduce((s, k) => s + k.gold, 0))}*`);
    goldOut.forEach(k => lines.push(`• ${k.name} — ${grams(k.gold)}`));
  }
  if (goldIn.length) {
    lines.push(``, `🟠 *GOLD OWED TO KARIGARS: ${grams(goldIn.reduce((s, k) => s + k.gold, 0))}*`);
    goldIn.forEach(k => lines.push(`• ${k.name} — ${grams(k.gold)}`));
  }
  lines.push(``, `━━━━━━━━━━━━━━━━━━`);
  return fromThisPos(lines.join('\n'));
}

export {
  buildDailyChecklist, buildEndOfDaySummary, buildDailyReport, buildWeeklyReport,
  buildOverdueOrders, buildGivenItems, buildKarigarPayments,
};
