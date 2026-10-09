/**
 * Adding pieces in bulk (src/app/products/bulk-add/page.tsx): the two small rules the page keeps to itself,
 * written down once so the iPhone app's copy (apps/iphone/App/Screens/Stock/StockBulkAdd.swift) has a tested
 * source to follow. The pieces themselves go through lib/writes/products.ts (`addProduct`), one at a time.
 */

/**
 * The weights in a pasted list: every run of digits and dots, read as a number, those above 0 kept
 * ("4.2, 5.1\n6.75" gives 4.2, 5.1 and 6.75; "1.2.3" and a lone dot are not numbers and are left out).
 * The page's `handlePasteWeights`.
 */
export function pastedWeights(text: string): number[] {
  return (text.match(/[\d.]+/g) ?? []).map(Number).filter((n) => !Number.isNaN(n) && n > 0);
}

/**
 * The name a bulk row's piece is given: the shared prefix and the row's own suffix, spaced, trimmed
 * ("Gold Ring Design A" + "no. 3"). Blank is no name: the store makes one from the category and the SKU.
 *
 * One difference from the page, on purpose: a suffix typed with no prefix names the piece by itself. The
 * page read the prefix first and threw the suffix away without a word.
 */
export function bulkPieceName(prefix: string | undefined, suffix: string | undefined): string {
  return [prefix, suffix].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
}
