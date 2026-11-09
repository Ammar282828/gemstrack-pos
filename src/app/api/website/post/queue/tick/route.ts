/**
 * POST → send the queued pieces whose time has come (Post a Piece's "Spread
 * over the day"), each claimed first so an overlapping or retried check can't
 * send it twice; a piece that fails is tried again at the next check, three
 * times in all. Also clears drafts that never finished arriving.
 *
 * Called every five minutes by Cloud Scheduler (job `social-queue-tick`, in
 * each house's project) with `Authorization: Bearer <CRON_SECRET>`.
 *
 * After the queue it sends the WhatsApp reports whose time has come (Settings → Notifications;
 * lib/notifications/schedule.ts) — in every house, with or without Post a Piece — and then, in
 * a house with the Ad studio, assesses the library in the background (assess-run.ts): a paced
 * slice in whatever time was left, so the photos get assessed with no page open. Their own jobs
 * would be cleaner; the cloud sessions can't create Scheduler jobs.
 * The Ad studio's houses also get this week's board on Mondays (lib/ads/studio/weekly.ts).
 * Every house also re-reads the link page's reviews when six hours old (lib/reviews-server.ts), and
 * a house that takes online orders looks after them (lib/website/online.ts sweepOnline: the shop
 * nudged about orders waiting to be confirmed, customers reminded before their hold ends, the shop
 * told when a hold has ended).
 * Once an hour it also keeps what Meta forgets for Insights — live stories' numbers and the day's
 * follower counts (lib/social-insights/snapshot.ts).
 * `?dry=1` answers what is due without sending anything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { mediaOrigin } from '@/lib/social/gate';
import { claimItem, dueItems, sendItem, sweep } from '@/lib/social/queue';
import { STORE_AD_STUDIO, STORE_POST_PIECE } from '@/lib/store-config';
import { aiConfigured } from '@/lib/social/ai';
import { loadAssessState, runAssessSlice } from '@/lib/ads/studio/assess-run';
import { loadWeekly, runWeeklySlice, startWeekly, weeklyDue } from '@/lib/ads/studio/weekly';
import { runDueReports } from '@/lib/notifications/dispatch';
import { refreshReviews } from '@/lib/reviews-server';
import { onlineOrdersPossible, sweepOnline } from '@/lib/website/online';
import { snapshotIfDue } from '@/lib/social-insights/snapshot';
import { syncSafepayFees } from '@/lib/safepay-fees-server';
import { syncShopifyBills } from '@/lib/shopify-bills-server';
import { syncTcsPayments } from '@/lib/tcs-payments-server';
import { catchUpShopifyDelivery, convertShopifyInvoicesToOrders, settlePaymentLinks, sweepShopifyOrders } from '@/lib/shopify-order-sweep';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Stop taking new pieces after this long, so the last one finishes inside the request. */
const BUDGET_MS = 150_000;

/** Online orders' nudges and reminders; a failure here must never stop the rest. */
async function online(dry: boolean) {
  try {
    if (!(await onlineOrdersPossible())) return null;
    return await sweepOnline(new Date(), dry);
  } catch (e) {
    console.warn('[queue/tick] online orders:', e instanceof Error ? e.message : e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The reports due now; a failure here must never stop the queue. */
async function reports(dry: boolean) {
  try {
    const r = await runDueReports({ by: 'tick', dry });
    return { due: r.due, results: r.results.filter(x => x.status !== 'already').map(x => ({ task: x.task, status: x.status, sent: x.sent, error: x.error })) };
  } catch (e) {
    console.warn('[queue/tick] reports:', e instanceof Error ? e.message : e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req, { strict: true })) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  // The link page's reviews, read again every six hours (reviews-server.ts); never in the way.
  if (!dry) await refreshReviews().then(r => { if (r.status === 'failed') console.warn('[queue/tick] reviews:', r.error); }).catch(() => undefined);
  const onlineOrders = await online(dry);
  // House of Mina's Shopify orders, read from Shopify every tick (lib/shopify-order-sweep.ts): imported and their
  // WhatsApp started even when Shopify's notices are refused. Never in the way of the rest.
  const shopifyOrders = dry ? null : await sweepShopifyOrders().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  if (shopifyOrders && 'imported' in shopifyOrders && (shopifyOrders.imported.length || shopifyOrders.whatsapp.length || shopifyOrders.errors.length)) console.log('[queue/tick] shopify orders', JSON.stringify(shopifyOrders));
  // Safepay payment links: a paid one's money onto its invoice or order (lib/writes/payment-links.ts).
  const paymentLinks = dry ? null : await settlePaymentLinks().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  if (paymentLinks && ('error' in paymentLinks || paymentLinks.paid.length || paymentLinks.errors.length)) console.log('[queue/tick] payment links', JSON.stringify(paymentLinks));
  // Once a day: Safepay's fees and the tax on them, a month to an expense (lib/safepay-fees.ts).
  const safepayFees = dry ? null : await syncSafepayFees().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  if (safepayFees) console.log('[queue/tick] safepay fees', JSON.stringify(safepayFees));
  // Once a day: Shopify's bills read from the shop's mailbox, each an expense in rupees (lib/shopify-bills-server.ts).
  const shopifyBills = dry ? null : await syncShopifyBills().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  if (shopifyBills) console.log('[queue/tick] shopify bills', JSON.stringify(shopifyBills));
  // Once a day: TCS's courier charges a month to an expense, and what TCS has paid out (lib/tcs-payments.ts).
  const tcsPayments = dry ? null : await syncTcsPayments().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  if (tcsPayments) console.log('[queue/tick] tcs payments', JSON.stringify(tcsPayments));
  // The old Shopify sales made orders (shipped → Completed beside their invoice, cancelled → Cancelled, open → the Workshop).
  const shopifyConvert = dry ? null : await convertShopifyInvoicesToOrders().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  if (shopifyConvert) console.log('[queue/tick] shopify convert', JSON.stringify(shopifyConvert));
  // Every ten minutes (the net under the live notices): each web order the ERP has against Shopify — paid, shipped, delivered by TCS, returned.
  const shopifyDelivery = dry ? null : await catchUpShopifyDelivery().catch(e => ({ error: e instanceof Error ? e.message : String(e) }));
  if (shopifyDelivery) console.log('[queue/tick] shopify delivery', JSON.stringify(shopifyDelivery));
  // Insights' hourly snapshot (stories die after a day); in every house with Meta, never in the way.
  const insights = dry ? null : await snapshotIfDue().catch(() => null);
  // The reports ride this tick in every house, so they come before the Post a Piece gate.
  if (!STORE_POST_PIECE) return NextResponse.json({ ok: true, onlineOrders, shopifyOrders, shopifyDelivery, insights, notifications: await reports(dry) });
  const started = Date.now();
  const due = await dueItems(new Date(started));
  if (dry) return NextResponse.json({ ok: true, dry: true, onlineOrders, due: due.map(d => ({ id: d.id, headline: d.headline, dueAt: d.dueAt, status: d.status })), notifications: await reports(true) });
  const results: { id: string; headline: string; status: string }[] = [];
  for (const d of due) {
    if (Date.now() - started > BUDGET_MS) break;
    const item = await claimItem(d.id, new Date());
    if (!item) continue;
    const after = await sendItem(item, { by: 'schedule', origin: mediaOrigin(req) });
    results.push({ id: d.id, headline: d.headline, status: after.status });
  }
  const swept = await sweep().catch(() => 0);
  if (results.length) console.log(`[queue/tick] ${results.map(r => `${r.headline || r.id}:${r.status}`).join(' ')}`);
  const notifications = await reports(false);

  // This week's board (weekly.ts): started on Monday from 9:00, Karachi, and designed a few pieces a tick.
  let weekly: { board: string | null; done: number; pending: number; failed: number } | null = null;
  if (STORE_AD_STUDIO && aiConfigured() && 240_000 - (Date.now() - started) > 90_000) {
    try {
      let w = await loadWeekly();
      if (weeklyDue(w, new Date())) w = await startWeekly(new Date());
      if (w.pending.length) w = await runWeeklySlice(Math.min(120_000, 240_000 - (Date.now() - started) - 30_000));
      weekly = { board: w.board, done: w.done, pending: w.pending.length, failed: w.failed.length };
    } catch (e) {
      console.warn('[queue/tick] weekly board:', e instanceof Error ? e.message : e);
    }
  }

  // The Ad studio's library, in the time left (the Scheduler's deadline is 300 s): a batch of ten
  // photographs, a pause, and so on — gentle on the AI key the counter shares.
  let assessed: { done: number; remaining: number; stopped: string | null; busy?: boolean } | null = null;
  const left = 240_000 - (Date.now() - started);
  if (STORE_AD_STUDIO && aiConfigured() && left > 60_000 && (await loadAssessState().then(s => s.background).catch(() => false))) {
    try {
      const r = await runAssessSlice({ budgetMs: Math.min(150_000, left - 45_000), by: 'background', paceMs: 12_000 });
      assessed = { done: r.done.length, remaining: r.remaining, stopped: r.stopped, busy: r.busy };
      if (r.done.length || r.stopped) console.log(`[queue/tick] assessed ${r.done.length}, ${r.remaining} left${r.stopped ? ` — ${r.stopped}` : ''}`);
    } catch (e) {
      console.warn('[queue/tick] assessing:', e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true, due: due.length, results, swept, onlineOrders, insights, notifications, weekly, assessed });
}
