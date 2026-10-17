/**
 * The product sets worth offering for a catalogue ad, biggest first (the first is the default).
 * Left out: Meta's own "Similar Items for … [Auto-Created Set]" (one to four pieces each) and the
 * "Set for url …" sets the Shopify app makes from a page address, which Mina's catalogue had 30-odd of
 * among 34 sets on 2026-10-16.
 */

export interface SetRow { id: string; name: string; product_count?: number | null }

export function catalogSets(rows: SetRow[]): { id: string; name: string; products: number | null }[] {
  return rows
    .filter(r => !/\[auto-created set\]/i.test(r.name) && !/^set for url /i.test(r.name))
    .map(r => ({ id: r.id, name: r.name, products: typeof r.product_count === 'number' ? r.product_count : null }))
    .sort((a, b) => (b.products ?? -1) - (a.products ?? -1));
}
