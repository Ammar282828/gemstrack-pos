import { describe, expect, it } from 'vitest';
import { campaignsCsv } from './export';
import { metricsOf, type TreeCampaign } from './shape';

const m = metricsOf({ spend: '1000', impressions: '5000', reach: '4000', actions: [{ action_type: 'omni_purchase', value: '2' }], action_values: [{ action_type: 'omni_purchase', value: '9000' }] });
const tree: TreeCampaign[] = [{
  id: 'C1', name: 'Rings, "Oct"', status: 'ACTIVE', effectiveStatus: 'ACTIVE', objective: 'OUTCOME_SALES', dailyBudget: null, lifetimeBudget: null,
  startTime: null, stopTime: null, issues: [], metrics: m,
  adsets: [{ id: 'S1', name: 'Broad', status: 'ACTIVE', effectiveStatus: 'ACTIVE', optimizationGoal: 'OFFSITE_CONVERSIONS', destination: 'WEBSITE', dailyBudget: 2000, lifetimeBudget: null, startTime: null, endTime: null, learning: null, issues: [], metrics: m,
    ads: [{ id: 'A1', name: 'Elsa', status: 'ACTIVE', effectiveStatus: 'ACTIVE', thumbnail: null, issues: [], metrics: m, creativeId: null, instagramPermalink: null, image: null, title: null, body: null, button: null }] }],
}];

describe('campaignsCsv', () => {
  const csv = campaignsCsv(tree);
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  it('one row per campaign, ad set and ad, under a header', () => {
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Level,Campaign,Ad set,Ad,Status/);
    expect(lines.slice(1).map(l => l.split(',')[0])).toEqual(['Campaign', 'Ad set', 'Ad']);
  });
  it('carries sales and ROAS, and quotes names with commas or quotes', () => {
    expect(lines[1]).toContain('"Rings, ""Oct"""');
    expect(lines[3]).toContain(',2,9000,9,500,A1');
  });
});
