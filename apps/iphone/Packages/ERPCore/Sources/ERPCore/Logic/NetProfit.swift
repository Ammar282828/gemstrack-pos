// Ported from src/lib/analytics/net-profit.ts (isRunningCost) and src/lib/expense-categories.ts (isGoodsExpense)
// (tests: NetProfitTests, from net-profit-running.test.ts).
//
// Net profit is the estimated profit, which already allows for the cost of the goods, less the running costs only:
// not a partner's drawings, and not the goods categories a house files as expenses (Mina's stock and karigars;
// the business descriptor's `goodsExpenseCategories`, Taheri none).

import Foundation

public enum NetProfit {
    /// Is this expense the cost of the goods themselves? Matched on the trimmed name, ignoring case.
    public static func isGoodsExpense(category: String?, goods: [String]) -> Bool {
        guard let category else { return false }
        let name = category.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !name.isEmpty else { return false }
        return goods.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == name }
    }

    public static func isGoodsExpense(_ e: Expense, goods: [String]) -> Bool { isGoodsExpense(category: e.category, goods: goods) }

    /// A cost of running the business: a business cost (not a drawing) that is not a goods category.
    public static func isRunningCost(category: String?, goods: [String]) -> Bool {
        Partnership.isBusinessCost(category: category) && !isGoodsExpense(category: category, goods: goods)
    }

    public static func isRunningCost(_ e: Expense, goods: [String]) -> Bool { isRunningCost(category: e.category, goods: goods) }

    /// Profit before the running costs (net-profit.ts `profitBeforeRunning`). A house that files its goods as expenses
    /// (Mina) knows what they cost, so it is revenue less those goods (gross profit; unsold stock counts as spent);
    /// otherwise the estimated profit. The owner, 2026-11-01: an assumed 40% beside goods at 84% of revenue was wrong.
    public static func beforeRunning(estimated: Double, revenue: Double, goods: Double, recordsGoods: Bool) -> Double {
        recordsGoods ? revenue - goods : estimated
    }
}

/// `isRunningCost(expense, goods:)`: the rule as a free function, as the web names it.
public func isRunningCost(_ e: Expense, goods: [String]) -> Bool { NetProfit.isRunningCost(e, goods: goods) }
