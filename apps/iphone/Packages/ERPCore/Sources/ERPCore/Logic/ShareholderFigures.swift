// Ported from src/lib/shareholder-figures.ts, the Shareholders page's figures
// (tests: ShareholderFiguresTests, from shareholder-figures.test.ts).
//
// The business's profit and loss since the partnership started, each partner's position from their
// ledger plus their half of it, and what unequal salaries move between them. A salary is not a draw:
// a draw hands a partner their own capital back and is no business cost; a salary pays them for work,
// a cost like any wage, so it stays inside profit and does not touch their equity.

import Foundation

public enum ShareholderFigures {
    /// Expenses from "Pearls - Studs x2" onward.
    public static let expenseCutoff = "2025-07-02"
    /// Revenue from Shopify order #1103 onward.
    public static let revenueCutoff = "2025-07-16"

    public struct Totals: Hashable {
        public let totalExpenses: Double
        public let totalRevenue: Double
        public let drawings: Double
        public let expShare: Double
        public let revShare: Double
    }

    /// A sale counts on the day its order was taken (store.ts getInvoiceRevenueDate).
    private static func revenueDate(_ inv: Invoice, _ ordersById: [String: Order]) -> String {
        if JS.has(inv.sourceOrderId), let order = ordersById[inv.sourceOrderId ?? ""], JS.has(order.createdAt) {
            return order.createdAt
        }
        return inv.createdAt
    }

    /// The business P&L since the partnership started, and each partner's half of it.
    public static func partnershipTotals(expenses: [Expense], invoices: [Invoice], orders: [Order],
                                         additionalRevenues: [AdditionalRevenue]) -> Totals {
        let ordersById = Dictionary(orders.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        // Drawings are excluded here on purpose: a partner taking money out is a reduction of their own
        // equity, not a shared cost. Counting it here would charge them for it twice.
        let businessExpenses = expenses.filter { $0.date >= expenseCutoff && Partnership.isBusinessCost($0) }
        let totalExpenses = businessExpenses.reduce(0) { $0 + $1.amount }

        let invoiceRevenue = invoices
            .filter { inv in JS.has(inv.createdAt) && inv.status != .refunded && revenueDate(inv, ordersById) >= revenueCutoff }
            .reduce(0) { $0 + invoiceSaleValue($1) } // part-exchange included, as Analytics

        var invoicedOrderIds = Set<String>()
        for o in orders where JS.has(o.invoiceId) { invoicedOrderIds.insert(o.id) }
        for inv in invoices where JS.has(inv.sourceOrderId) { invoicedOrderIds.insert(inv.sourceOrderId ?? "") }
        let orderRevenue = orders
            .filter { o in
                JS.has(o.createdAt) && o.status != .cancelled && o.status != .refunded
                    && !invoicedOrderIds.contains(o.id) && o.createdAt >= revenueCutoff
            }
            .reduce(0) { $0 + ($1.subtotal.isNaN ? 0 : $1.subtotal) }

        let additionalRev = additionalRevenues
            .filter { $0.date >= revenueCutoff }
            .reduce(0) { $0 + $1.amount }

        let totalRevenue = invoiceRevenue + orderRevenue + additionalRev
        let drawings = expenses
            .filter { $0.date >= expenseCutoff && $0.category == Partnership.partnerDrawings }
            .reduce(0) { $0 + $1.amount }

        return Totals(totalExpenses: totalExpenses, totalRevenue: totalRevenue, drawings: drawings,
                      expShare: totalExpenses / 2, revShare: totalRevenue / 2)
    }

    /// Salary rows live in Expenses, not the ledger: a wage is a cost of doing business, not a movement
    /// of anybody's capital. Newest first, per partner.
    public static func salariesByPartner(_ expenses: [Expense]) -> [String: [Expense]] {
        var out: [String: [Expense]] = ["mina": [], "ammar": []]
        for e in expenses {
            guard e.category == Partnership.partnerSalary, let who = e.shareholderId, !who.isEmpty else { continue }
            out[who, default: []].append(e)
        }
        for k in Array(out.keys) {
            out[k] = (out[k] ?? []).jsSorted { a, b in Double(JS.localeCompare(b.date, a.date)) }
        }
        return out
    }

    /// The rows the web's ledger read shows: ordered by date, newest first, so a row with no date is not
    /// on the page (Firestore leaves a document without the ordered field out of the read).
    public static func shown(_ rows: [ShareholderLedgerRow]) -> [ShareholderLedgerRow] {
        rows.filter { !$0.date.isEmpty }
            .jsSorted { a, b in
                let x = ERPDate.parse(a.date)?.timeIntervalSince1970 ?? 0
                let y = ERPDate.parse(b.date)?.timeIntervalSince1970 ?? 0
                return y - x
            }
    }

    public struct Position: Identifiable, Hashable {
        public let id: String
        public let name: String
        public let rows: [ShareholderLedgerRow]
        public let payments: [ShareholderLedgerRow]
        public let withdrawals: [ShareholderLedgerRow]
        public let salaries: [Expense]
        public let contributed: Double
        public let withdrawn: Double
        public let salaryPaid: Double
        public let balance: PartnerBalance
    }

    /// One partner's position, from their ledger plus their half of the P&L.
    public static func partnerPositions(partners: [(id: String, name: String)], ledgers: [String: [ShareholderLedgerRow]],
                                        salariesBy: [String: [Expense]], totals: Totals) -> [Position] {
        partners.map { s in
            let rows = ledgers[s.id] ?? []
            let payments = rows.filter { $0.type == .payment }
            let withdrawals = rows.filter { $0.type == .withdrawal }
            let buckets = Partnership.categorise(payments: payments, withdrawals: withdrawals)
            let salaries = salariesBy[s.id] ?? []
            return Position(
                id: s.id, name: s.name,
                rows: rows, payments: payments, withdrawals: withdrawals, salaries: salaries,
                contributed: payments.reduce(0) { $0 + $1.amount },
                withdrawn: withdrawals.reduce(0) { $0 + $1.amount },
                salaryPaid: salaries.reduce(0) { $0 + $1.amount },
                balance: Partnership.partnerBalance(buckets, expShare: totals.expShare, revShare: totals.revShare)
            )
        }
    }

    public struct SalaryGap: Hashable {
        public let ahead: Position
        public let behind: Position
        public let transferred: Double
    }

    /// Unequal salaries quietly move money between partners; equal ones cancel.
    public static func salaryGap(_ positions: [Position]) -> SalaryGap? {
        guard positions.count >= 2 else { return nil }
        let a = positions[0], b = positions[1]
        let diff = a.salaryPaid - b.salaryPaid
        if abs(diff) < 1 { return nil }
        let ahead = diff > 0 ? a : b
        let behind = diff > 0 ? b : a
        return SalaryGap(ahead: ahead, behind: behind, transferred: abs(diff) / 2)
    }
}
