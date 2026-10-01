/**
 * The morning WhatsApp line on yesterday's ads — the owner's "how did the ads
 * do?" answered before it is asked. Sent by /api/notifications/run (task
 * `ads-daily`, Cloud Scheduler 09:30 Asia/Karachi) to the shop's alert
 * numbers when Settings → Notifications → Ads Summary is on.
 *
 * Yesterday against the seven days before it (per day), this month's pace,
 * the ad that brought most, and the top three things needing attention —
 * short enough to read at a glance on a phone.
 *
 * `buildAdsDigest` is pure (tested); `adsDigest` gathers the numbers.
 */

import { STORE_CONFIG } from '@/lib/store-config';
import { attentionItems, pacing, type AttentionItem } from './attention';
import { accountSummary, requireAccount } from './settings';
import { topAds, totals, tree } from './insights';
import { currencyOffset, headlineActions, money, resultOf, type AdsAccount, type Metrics } from './shape';
import type { AlertDoc, Section } from '@/lib/notifications/doc';

export interface DigestInput {
  shop: string;
  account: AdsAccount;
  yesterday: Metrics;
  /** The seven days before yesterday, whole. */
  weekBefore: Metrics;
  month: ReturnType<typeof pacing>;
  topAd: { name: string; metrics: Metrics; goal: string | null } | null;
  attention: AttentionItem[];
  erpUrl: string;
  date: string;
}

/** "+18%" / "−9%" / "same", yesterday against the week's daily average. */
function vs(now: number, before: number): string {
  if (!before) return now ? 'new' : '';
  const d = ((now - before) / before) * 100;
  if (Math.abs(d) < 3) return 'same as usual';
  return `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}% vs the week`;
}

export function buildAdsDigest(d: DigestInput): string {
  const cur = d.account.currency;
  const y = d.yesterday;
  const avg = (n: number) => n / 7;
  const chats = y.actions['onsite_conversion.messaging_conversation_started_7d'] ?? 0;
  const chatsBefore = d.weekBefore.actions['onsite_conversion.messaging_conversation_started_7d'] ?? 0;
  const lines: string[] = [];
  lines.push(`📣 *${d.shop} — Ads yesterday* (${d.date})`);
  if (y.spend === 0 && y.impressions === 0) {
    lines.push('Nothing ran yesterday.');
  } else {
    lines.push(`Spent *${money(y.spend, cur)}* (${vs(y.spend, avg(d.weekBefore.spend))})`);
    lines.push(`Reached ${Math.round(y.reach).toLocaleString('en-US')} people · ${y.clicks.toLocaleString('en-US')} clicks`);
    if (chats || chatsBefore) {
      lines.push(`Chats started: *${chats}* (${vs(chats, avg(chatsBefore))})${chats ? ` · ${money(y.spend / chats, cur)} each` : ''}`);
    } else {
      const acts = headlineActions(y, 2);
      if (acts.length) lines.push(acts.map(a => `${a.label}: *${a.value.toLocaleString('en-US')}*`).join(' · '));
    }
  }
  if (d.topAd) {
    const r = resultOf(d.topAd.metrics, d.topAd.goal ?? undefined);
    lines.push(`Best ad: ${d.topAd.name} — ${money(d.topAd.metrics.spend, cur)}${r && r.value ? `, ${r.value} ${r.label.toLowerCase()}` : ''}`);
  }
  lines.push(`This month: ${money(d.month.spent, cur)} so far, heading for ~${money(d.month.projected, cur)}${d.month.lastMonth ? ` (last month ${money(d.month.lastMonth, cur)})` : ''}`);
  const top = d.attention.filter(a => a.severity !== 'tip').slice(0, 3);
  if (top.length) {
    lines.push('');
    lines.push('*Needs a look:*');
    for (const a of top) lines.push(`${a.severity === 'bad' ? '🔴' : '🟡'} ${a.title}`);
  } else if (d.attention.length) {
    lines.push(`💡 ${d.attention[0].title}`);
  } else if (y.spend > 0) {
    lines.push('✅ Nothing needs attention.');
  }
  lines.push('');
  lines.push(`${d.erpUrl}/ads`);
  return lines.join('\n');
}

/** The same digest as a document: the WhatsApp report is a PDF now (lib/notifications/doc.ts). */
export function adsDigestDoc(d: DigestInput, now = new Date()): AlertDoc {
  const cur = d.account.currency;
  const y = d.yesterday;
  const avg = (n: number) => n / 7;
  const CHAT = 'onsite_conversion.messaging_conversation_started_7d';
  const chats = y.actions[CHAT] ?? 0;
  const chatsBefore = d.weekBefore.actions[CHAT] ?? 0;
  const ran = !(y.spend === 0 && y.impressions === 0);
  const acts = headlineActions(y, 4);
  const top = d.attention.filter(a => a.severity !== 'tip').slice(0, 5);
  const sections: Section[] = [];
  if (ran) sections.push({
    title: 'Yesterday against the week before',
    note: 'per day',
    table: {
      columns: [{ label: '' }, { label: 'Yesterday', width: 24, align: 'right' }, { label: 'Week, a day', width: 24, align: 'right' }],
      rows: [
        ['Spent', money(y.spend, cur), money(avg(d.weekBefore.spend), cur)],
        ['Reached', Math.round(y.reach).toLocaleString('en-US'), Math.round(avg(d.weekBefore.reach)).toLocaleString('en-US')],
        ['Clicks', y.clicks.toLocaleString('en-US'), Math.round(avg(d.weekBefore.clicks)).toLocaleString('en-US')],
        ...(chats || chatsBefore ? [['Chats started', String(chats), avg(chatsBefore).toFixed(1)]] : []),
        ...acts.filter(a => a.type !== CHAT).map(a => [a.label, a.value.toLocaleString('en-US'), Math.round(avg(d.weekBefore.actions[a.type] ?? 0)).toLocaleString('en-US')]),
      ],
    },
  });
  if (d.topAd) {
    const r = resultOf(d.topAd.metrics, d.topAd.goal ?? undefined);
    sections.push({ title: 'Best ad yesterday', pairs: [
      { label: d.topAd.name, value: money(d.topAd.metrics.spend, cur), strong: true },
      ...(r && r.value ? [{ label: r.label, value: r.value.toLocaleString('en-US') }] : []),
    ] });
  }
  sections.push({ title: 'This month', pairs: [
    { label: 'Spent so far', value: money(d.month.spent, cur) },
    { label: 'Heading for', value: `~${money(d.month.projected, cur)}`, strong: true },
    ...(d.month.lastMonth ? [{ label: 'Last month', value: money(d.month.lastMonth, cur) }] : []),
  ] });
  sections.push({
    title: 'Needs a look',
    table: top.length ? {
      columns: [{ label: 'What' }],
      rows: top.map(a => [a.title]),
      tones: top.map(a => (a.severity === 'bad' ? 'flag' : undefined)),
      details: top.map(a => a.why),
    } : undefined,
    text: !top.length && d.attention.length ? [`Tip: ${d.attention[0].title}`] : undefined,
    empty: ran ? 'Nothing needs attention.' : 'Nothing ran.',
  });
  return {
    kind: 'ads-daily',
    title: 'Ads yesterday',
    heading: d.date,
    subheading: ran ? `${money(y.spend, cur)} spent · ${vs(y.spend, avg(d.weekBefore.spend)) || 'first day'}` : 'Nothing ran yesterday.',
    headline: `${d.date} · ${ran ? `spent ${money(y.spend, cur)}${chats ? ` · ${chats} chats` : ''}` : 'nothing ran'}`,
    figures: ran ? [
      { label: 'Spent', value: money(y.spend, cur), note: vs(y.spend, avg(d.weekBefore.spend)) },
      chats || chatsBefore
        ? { label: 'Chats started', value: String(chats), note: chats ? `${money(y.spend / chats, cur)} each` : vs(chats, avg(chatsBefore)) }
        : { label: 'Clicks', value: y.clicks.toLocaleString('en-US'), note: `${Math.round(y.reach).toLocaleString('en-US')} reached` },
    ] : [{ label: 'Spent', value: money(0, cur), note: 'nothing ran' }],
    sections,
    footnote: d.erpUrl ? `Open Ads in the ERP: ${d.erpUrl}/ads` : undefined,
    at: now,
  };
}

/** Yesterday's date and the seven days before it, in the account's time zone. */
export function digestRanges(now: Date, tz: string): { yesterday: { since: string; until: string }; weekBefore: { since: string; until: string }; label: string } {
  const day = (offset: number) => {
    const d = new Date(now.getTime() - offset * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };
  return {
    yesterday: { since: day(1), until: day(1) },
    weekBefore: { since: day(8), until: day(2) },
    label: new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(now.getTime() - 86_400_000)),
  };
}

/** Yesterday's numbers, gathered for the digest. */
export async function digestInput(now = new Date()): Promise<DigestInput> {
  const { act } = await requireAccount();
  const account = await accountSummary(act);
  const tz = account.timezone || 'Asia/Karachi';
  const ranges = digestRanges(now, tz);
  const [y, w, thisMonth, lastMonth, top, campaigns] = await Promise.all([
    totals(act, ranges.yesterday),
    totals(act, ranges.weekBefore).catch(() => null),
    totals(act, 'this_month').catch(() => null),
    totals(act, 'last_month').catch(() => null),
    topAds(act, 'yesterday', 1).catch(() => []),
    tree(act, 'last_7d', { offset: currencyOffset(account.currency) }).catch(() => []),
  ]);
  const monthDay = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) + 'T12:00:00');
  return {
    shop: STORE_CONFIG.name,
    account,
    yesterday: y.metrics,
    weekBefore: w?.metrics ?? y.metrics,
    month: pacing(thisMonth?.metrics.spend ?? 0, lastMonth?.metrics.spend ?? 0, monthDay),
    topAd: top[0] ? { name: top[0].name, metrics: top[0].metrics, goal: top[0].goal } : null,
    attention: attentionItems({ account, campaigns, days: 7, now: now.getTime() }),
    erpUrl: (STORE_CONFIG.appUrl || '').replace(/\/+$/, ''),
    date: ranges.label,
  };
}

/** The digest as words (the text the report used to be). */
export async function adsDigest(now = new Date()): Promise<string> {
  return buildAdsDigest(await digestInput(now));
}
