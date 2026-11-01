import { isBusinessCost } from '@/lib/partnership';
import { isGoodsExpense, GOODS_EXPENSE_CATEGORIES } from '@/lib/expense-categories';

/**
 * Net profit = the estimated profit less the expenses (owner, 2026-10-25: "5.51 crore, 100.0% margin" with the
 * estimate at 55 lac). Revenue less expenses ignored what the goods cost, so a jewellery shop read ~100% margin.
 * `estimatedProfit` is already each sale's own margin (lib/margin.ts), so it carries the cost of the goods.
 * The expenses are the running costs only (`isRunningCost`): not the partners' drawings, and not the goods
 * themselves where a house files them as expenses (Mina's stock and karigars), which the margin already took off.
 */
export function netProfit(estimatedProfit: number, expenses: number): number {
  return (estimatedProfit || 0) - (expenses || 0);
}

/** Net profit as a share of revenue, in percent; 0 where there was no revenue. */
export function netMarginPercent(net: number, revenue: number): number {
  return revenue > 0 ? (net / revenue) * 100 : 0;
}

/**
 * An expense that counts against net profit: a cost of running the business. Not a partner's drawings (a share of
 * the profit, not a cost of earning it) and not the cost of the goods (`isGoodsExpense`), which the estimated
 * profit's margin already allows for — counting it again made Mina's net -1.15 crore on 2026-10-31.
 */
export const isRunningCost = (e: { category?: string | null }): boolean => isBusinessCost(e) && !isGoodsExpense(e);

/**
 * A house that files what its goods cost as expenses (Mina: stock and karigars, stones, plating) knows that cost; a
 * guessed margin does not. The owner, 2026-11-01, on Mina's all-time 39.96 lac net ("isnt this still wrong?"):
 * revenue 1.84 crore at an assumed 40% beside 1.55 crore of goods actually bought (84% of revenue). So where goods
 * are recorded, profit before running costs is revenue less those goods (gross profit), and net is that less the
 * running costs. Goods bought but not yet sold count as spent: the figure is what came in less what went out.
 * Taheri records no goods (they are costed per sale from the 24k rate), so it keeps the estimate.
 */
export const RECORDS_GOODS = GOODS_EXPENSE_CATEGORIES.length > 0;

export function profitBeforeRunning(p: { estimated: number; revenue: number; goods: number }, recordsGoods = RECORDS_GOODS): number {
  return recordsGoods ? (p.revenue || 0) - (p.goods || 0) : (p.estimated || 0);
}
