/**
 * Campaigns as a spreadsheet: every campaign, ad set and ad on the Campaigns tab, one row each, with the
 * numbers Ads Manager's Export gives (spend, reach, results, sales, ROAS). Pure — built in the browser from
 * what the tab already shows, so the file always matches the screen.
 */

import { resultOf, salesOf, type Metrics, type TreeCampaign } from './shape';

const HEAD = [
  'Level', 'Campaign', 'Ad set', 'Ad', 'Status', 'Objective / goal', 'Daily budget', 'Total budget',
  'Spent', 'Impressions', 'Reach', 'Frequency', 'Clicks', 'Link clicks', 'CTR %', 'CPM', 'CPC',
  'Results', 'Result type', 'Cost per result', 'Purchases', 'Sales', 'ROAS', 'Cost per purchase', 'ID',
];

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function numbers(m: Metrics, goal: string | undefined): unknown[] {
  const r = resultOf(m, goal);
  const s = salesOf(m);
  return [
    m.spend, m.impressions, m.reach, m.frequency, m.clicks, m.linkClicks, m.ctr, m.cpm, m.cpc,
    r?.value ?? '', r?.label ?? '', r && r.value > 0 ? m.spend / r.value : '',
    s.purchases || '', s.value || '', s.roas !== null && s.value ? s.roas : '', s.costPerPurchase ?? '',
  ];
}

/** CSV text (UTF-8, with a BOM so Excel reads the rupee names right). */
export function campaignsCsv(campaigns: TreeCampaign[]): string {
  const rows: unknown[][] = [HEAD];
  for (const c of campaigns) {
    const goal = c.adsets[0]?.optimizationGoal;
    rows.push(['Campaign', c.name, '', '', c.effectiveStatus, c.objective, c.dailyBudget, c.lifetimeBudget, ...numbers(c.metrics, goal), c.id]);
    for (const s of c.adsets) {
      rows.push(['Ad set', c.name, s.name, '', s.effectiveStatus, s.optimizationGoal, s.dailyBudget, s.lifetimeBudget, ...numbers(s.metrics, s.optimizationGoal), s.id]);
      for (const a of s.ads) rows.push(['Ad', c.name, s.name, a.name, a.effectiveStatus, s.optimizationGoal, '', '', ...numbers(a.metrics, s.optimizationGoal), a.id]);
    }
  }
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
