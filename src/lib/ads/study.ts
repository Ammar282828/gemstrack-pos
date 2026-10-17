/**
 * A/B tests (Ads Manager's "A/B test"): Meta's split test, which keeps the people who see each ad set apart
 * and says which one won on cost per result. Two to five ad sets, an even split, a start and an end.
 *
 * Meta creates studies on the business (`/{business}/ad_studies`), not the ad account. Pure: the route sends it.
 */

export interface StudyInput { name: string; adsetIds: string[]; start: string; end: string; pixelId?: string | null; purchases?: boolean }

export function studyProblems(s: StudyInput, now = Date.now()): string[] {
  const out: string[] = [];
  const ids = [...new Set(s.adsetIds)];
  if (!s.name.trim()) out.push('Give the test a name.');
  if (ids.length < 2) out.push('Choose at least two ad sets to compare.');
  if (ids.length > 5) out.push('A test compares at most five ad sets.');
  const start = Date.parse(s.start), end = Date.parse(s.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) out.push('Choose when the test starts and ends.');
  else {
    if (start < now - 10 * 60_000) out.push('The start has passed.');
    if (end - start < 86_400_000) out.push('A test needs to run for at least a day (a week gives a clearer answer).');
    if (end - start > 30 * 86_400_000) out.push('A test runs for at most 30 days.');
  }
  if (s.purchases && !s.pixelId) out.push('Comparing on purchases needs the website pixel (Setup).');
  return out;
}

/** Whole-number shares that add up to 100 (Meta: each at least 10): 3 → 34, 33, 33. */
export function evenSplit(n: number): number[] {
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

export function studyParams(s: StudyInput): Record<string, unknown> {
  const ids = [...new Set(s.adsetIds)];
  const split = evenSplit(ids.length);
  return {
    name: s.name.trim().slice(0, 200),
    type: 'SPLIT_TEST',
    start_time: Math.floor(Date.parse(s.start) / 1000),
    end_time: Math.floor(Date.parse(s.end) / 1000),
    cells: ids.map((id, i) => ({ name: String.fromCharCode(65 + i), treatment_percentage: split[i], adsets: [id] })),
    ...(s.purchases && s.pixelId ? { objectives: [{ name: 'Purchases', type: 'CONVERSIONS', is_primary: true, adspixels: [{ id: s.pixelId, event_names: ['fb_pixel_purchase'] }] }] } : {}),
  };
}
