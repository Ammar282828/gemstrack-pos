/**
 * Shopify's bills, read from the shop's mailbox over IMAP (lib/shopify-bills.ts parses them) and written as expenses
 * (Software & Subscriptions, in rupees at the bill day's rate). Server only; imapflow and mailparser are loaded when used.
 *
 *   app_private/bill-mail        {host, port, user, password(sealed)}   never sent to a client
 *   shopify_sync/bills           {at, since, resume, runs…, retryAfter, lastError}
 *   shopify_sync/bills-unparsed  the first Shopify mail that could not be read (subject + outline, digits masked)
 *   shopify_bills/<id>           the parsed bill (no body)
 *   expenses/shopify-bill-<id>   the expense, set with merge: one per bill, never twice
 */
import { createHash } from 'crypto';
import { adminDb } from '@/lib/firebase-admin';
import { recordedByHand, twinOf } from '@/lib/manual-twins';
import { openSecret, sealSecret } from '@/lib/safepay-fees';
import { describeLines, isShopifyBillMail, parseShopifyBill, type ShopifyBill } from '@/lib/shopify-bills';

export type BillMailCreds = { host: string; port: number; user: string; password: string };
export const DEFAULT_BILL_HOST = 'imap.secureserver.net';
export const DEFAULT_BILL_PORT = 993;
export const BILL_CATEGORY = 'Software & Subscriptions';
export const BILL_LOGIN_ERROR = 'The mailbox refused the login — check the address and password (GoDaddy: the email password, not the GoDaddy account one)';

const PRIVATE = () => adminDb.collection('app_private').doc('bill-mail');
const STATE = () => adminDb.collection('shopify_sync').doc('bills');
const FIRST_SINCE = new Date('2023-01-01T00:00:00Z');
const BUDGET_MS = 90_000;
const RETRY_AFTER_FAIL_MS = 6 * 3600_000;

export async function saveBillMail(c: BillMailCreds | null): Promise<void> {
  const at = new Date().toISOString();
  if (!c) { await PRIVATE().set({ host: null, port: null, user: null, password: null, at }); await STATE().set({ at: null, since: null, resume: null, retryAfter: null, lastError: null }, { merge: true }); return; }
  await PRIVATE().set({ host: c.host, port: c.port, user: c.user, password: sealSecret(c.password), at });
}

export async function billMailCreds(): Promise<BillMailCreds | null> {
  const d = (await PRIVATE().get()).data();
  if (!d || typeof d.user !== 'string' || !d.user || typeof d.password !== 'string') return null;
  const password = openSecret(d.password);
  if (!password) return null;
  return { host: String(d.host || DEFAULT_BILL_HOST), port: Number(d.port) || DEFAULT_BILL_PORT, user: d.user, password };
}

export type BillMailStatus = { connected: boolean; user?: string; bills?: number; lastAt?: string; error?: string; yearTotal?: number };
export async function billMailStatus(): Promise<BillMailStatus> {
  const d = (await PRIVATE().get()).data();
  if (!d || typeof d.user !== 'string' || !d.user) return { connected: false };
  const s = (await STATE().get()).data() || {};
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const yearTotal = (await adminDb.collection('shopify_bills').where('date', '>=', yearStart).get().catch(() => null))?.docs.reduce((n, d) => n + (Number(d.data().amount) || 0), 0) ?? 0;
  return {
    yearTotal,
    connected: true, user: d.user, bills: typeof s.bills === 'number' ? s.bills : 0,
    ...(s.at ? { lastAt: s.at as string } : {}), ...(s.lastError ? { error: String(s.lastError) } : {}),
  };
}

async function open(c: BillMailCreds) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({ host: c.host, port: c.port, secure: c.port !== 143, auth: { user: c.user, pass: c.password }, logger: false, socketTimeout: 60_000 });
  client.on('error', () => undefined);
  try { await client.connect(); } catch (e) {
    const err = e as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
    if (err.authenticationFailed || /auth|login|credentials/i.test(`${err.responseText ?? ''} ${err.message ?? ''}`)) throw new Error(BILL_LOGIN_ERROR);
    throw new Error(`Could not reach the mailbox at ${c.host}:${c.port} (${err.code || err.message || 'no answer'}).`);
  }
  return client;
}

/** Logs in and out: throws the reason in words. */
export async function testBillMail(c: BillMailCreds): Promise<void> {
  const client = await open(c);
  await client.logout().catch(() => undefined);
}

// ── rates ────────────────────────────────────────────────────────────────────────────────────────────────────────
const rateCache = new Map<string, number>();
/** PKR per 1 unit of `cur` on `day` (yyyy-mm-dd): the historical rate, else the latest. */
export async function pkrRate(cur: string, day: string): Promise<number> {
  const c = cur.toLowerCase();
  if (c === 'pkr') return 1;
  const key = `${c}@${day}`;
  const hit = rateCache.get(key);
  if (hit) return hit;
  for (const ver of [day, 'latest']) {
    try {
      const res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${ver}/v1/currencies/${c}.json`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      const r = (await res.json())?.[c]?.pkr;
      if (typeof r === 'number' && r > 0) { rateCache.set(key, r); return r; }
    } catch { /* next */ }
  }
  throw new Error(`No exchange rate for ${cur.toUpperCase()} to PKR.`);
}

const SYM: Record<string, string> = { USD: '$', GBP: '£', EUR: '€' };
const money = (n: number, cur: string) => `${SYM[cur] ?? cur + ' '}${n.toFixed(2)}`;

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const dayOf = (iso: string) => iso.slice(0, 10);
const mask = (s: string) => s.replace(/\d/g, '9');

type Mail = { uid: number; from: string; subject: string; date: Date; messageId: string };

/** Writes a parsed bill and its expense; false when it was already kept. */
async function keepBill(m: Mail, bill: ShopifyBill, now: Date): Promise<boolean> {
  const id = bill.billNo ? `n${bill.billNo.replace(/[^A-Za-z0-9-]/g, '')}` : `m${hash(m.messageId || `${m.date.toISOString()}|${m.subject}`)}`;
  const ref = adminDb.collection('shopify_bills').doc(id);
  if ((await ref.get()).exists) return false;
  const day = dayOf(bill.date);
  const rate = await pkrRate(bill.currency, day);
  const amount = Math.round(bill.total * rate);
  // Already in the books by hand (same bill, near the date, about the amount): linked, not added again.
  const near = (n: number) => new Date(Date.parse(bill.date) + n * 86400_000).toISOString().slice(0, 10);
  const hand = await recordedByHand(near(-20), near(20));
  const used = new Set((await adminDb.collection('shopify_bills').where('matchedExpense', '>', '').select('matchedExpense').get()).docs.map(d => String(d.data().matchedExpense)));
  const twin = twinOf(hand, { date: bill.date, amount }, /shopify/i, used);
  if (twin) {
    await ref.set({
      ...(bill.billNo ? { billNo: bill.billNo } : {}), messageId: m.messageId, subject: m.subject.slice(0, 200), date: bill.date,
      total: bill.total, currency: bill.currency, rate, amount, matchedExpense: twin.id, keptAt: now.toISOString(),
    });
    return false;
  }
  const parts = describeLines(bill.lines);
  const description = `Shopify bill${bill.billNo ? ` #${bill.billNo}` : ''} — ${money(bill.total, bill.currency)}${parts ? ` (${parts})` : ''}${bill.currency === 'PKR' ? '' : ` at ${Math.round(rate * 10) / 10}`}`;
  await adminDb.collection('expenses').doc(`shopify-bill-${id.slice(1)}`).set({
    date: bill.date, category: BILL_CATEGORY, description, amount, paidBy: 'business', source: 'shopify-bill',
    original: { currency: bill.currency, total: bill.total },
  }, { merge: true });
  await ref.set({
    ...(bill.billNo ? { billNo: bill.billNo } : {}), messageId: m.messageId, subject: m.subject.slice(0, 200), date: bill.date,
    total: bill.total, currency: bill.currency, rate, amount, lines: bill.lines,
    ...(bill.periodFrom ? { periodFrom: bill.periodFrom } : {}), ...(bill.periodTo ? { periodTo: bill.periodTo } : {}), keptAt: now.toISOString(),
  });
  return true;
}

export type BillsRun = { bills: number; months: number; total: number; read: number; done: boolean };

/** Once a day (the tick): new Shopify bills from the mailbox become expenses. First run reads everything since 2023. */
export async function syncShopifyBills(now = new Date(), force = false): Promise<BillsRun | null> {
  const creds = await billMailCreds();
  if (!creds) return null;
  const stateRef = STATE();
  const st = (await stateRef.get()).data() || {};
  const resuming = st.resume && typeof st.resume === 'object';
  if (!force) {
    if (st.retryAfter && Date.parse(st.retryAfter) > now.getTime()) return null;
    if (!resuming && st.at && now.getTime() - Date.parse(st.at) < 24 * 3600_000) return null;
  }
  const started = now.getTime();
  const runStart: string = resuming && st.runStart && !force ? st.runStart : now.toISOString();
  const since = force && !resuming ? (st.at ? new Date(Date.parse(st.at) - 7 * 86400_000) : FIRST_SINCE)
    : resuming && st.since ? new Date(st.since) : st.at ? new Date(Date.parse(st.at) - 7 * 86400_000) : FIRST_SINCE;
  const resume: Record<string, number> = resuming && !force ? { ...st.resume } : {};
  const { simpleParser } = await import('mailparser');

  let read = 0, kept = 0, unparsed = 0, done = true;
  let client: Awaited<ReturnType<typeof open>> | null = null;
  try {
    client = await open(creds);
    const boxes = (await client.list()).filter(b => b.path === 'INBOX' || /archive|all mail/i.test(b.path) || (b.specialUse && /\\(All|Archive)/.test(b.specialUse)));
    for (const box of boxes) {
      const lock = await client.getMailboxLock(box.path);
      try {
        const found = await client.search({ from: 'shopify', since }, { uid: true });
        const after = resume[box.path] ?? 0;
        const uids = (found || []).filter(u => u > after).sort((a, b) => a - b);
        // Headers first (cheap); only a bill's whole message is downloaded.
        const mails: Mail[] = [];
        if (uids.length) {
          for await (const msg of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
            mails.push({
              uid: msg.uid, from: (msg.envelope?.from || []).map(a => `${a.name ?? ''} <${a.address ?? ''}>`).join(', '),
              subject: msg.envelope?.subject || '', date: msg.envelope?.date ? new Date(msg.envelope.date) : new Date(msg.internalDate || now),
              messageId: msg.envelope?.messageId || '',
            });
          }
        }
        for (const m of mails.sort((a, b) => a.uid - b.uid)) {
          if (Date.now() - started > BUDGET_MS) { done = false; break; }
          read++;
          resume[box.path] = m.uid;
          if (!isShopifyBillMail(m)) continue;
          const dl = await client.download(String(m.uid), undefined, { uid: true });
          if (!dl?.content) continue;
          const mail = await simpleParser(dl.content);
          const text = mail.text || (typeof mail.html === 'string' ? mail.html.replace(/<(br|\/p|\/tr|\/div|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') : '');
          const bill = parseShopifyBill({ subject: m.subject, text, date: m.date });
          if (!bill) {
            unparsed++;
            const u = adminDb.collection('shopify_sync').doc('bills-unparsed');
            if (!(await u.get()).exists) await u.set({ at: now.toISOString(), subject: m.subject.slice(0, 200), from: m.from.replace(/\d/g, '9'), outline: text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 40).map(l => mask(l).slice(0, 160)) });
            continue;
          }
          if (await keepBill(m, bill, now)) kept++;
        }
      } finally { lock.release(); }
      if (!done) break;
    }
    await client.logout().catch(() => undefined);
  } catch (e) {
    if (client) await client.logout().catch(() => undefined);
    const message = e instanceof Error ? e.message : String(e);
    await stateRef.set({ retryAfter: new Date(now.getTime() + RETRY_AFTER_FAIL_MS).toISOString(), lastError: message.slice(0, 300) }, { merge: true });
    throw e instanceof Error ? e : new Error(message);
  }

  const snap = await adminDb.collection('shopify_bills').get();
  const months = new Set<string>();
  let total = 0;
  for (const d of snap.docs) { const x = d.data(); months.add(String(x.date).slice(0, 7)); total += Number(x.amount) || 0; }
  await stateRef.set(done
    ? { at: runStart, since: null, resume: null, runStart: null, retryAfter: null, lastError: null, bills: snap.size, read, kept, unparsed }
    : { since: since.toISOString(), resume, runStart, retryAfter: null, lastError: null, bills: snap.size }, { merge: true });
  return { bills: snap.size, months: months.size, total, read, done };
}
