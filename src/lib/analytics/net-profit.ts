/**
 * Net profit = the estimated profit less the expenses (owner, 2026-10-25: "5.51 crore, 100.0% margin" with the
 * estimate at 55 lac). Revenue less expenses ignored what the goods cost, so a jewellery shop read ~100% margin.
 * `estimatedProfit` is already each sale's own margin (lib/margin.ts), so it carries the cost of the goods.
 */
export function netProfit(estimatedProfit: number, expenses: number): number {
  return (estimatedProfit || 0) - (expenses || 0);
}

/** Net profit as a share of revenue, in percent; 0 where there was no revenue. */
export function netMarginPercent(net: number, revenue: number): number {
  return revenue > 0 ? (net / revenue) * 100 : 0;
}
