#if os(macOS)
import SwiftUI
import ERPCore

// Analytics › Overview on the Mac: the money and the counts as two rows of plain figures with their change, the revenue
// chart (it reads out on hover), then everything the iPhone folds away in disclosures laid open: where the revenue came
// from, the cash that moved, the expenses by category and the gold sold by karat as tables, the coins on their own.

struct MacReportsOverview: View {
    let c: MacReportsContext

    @State private var expenseSort = [KeyPathComparator(\MacReportsExpenseRow.amount, order: .reverse)]
    @State private var karatSort = [KeyPathComparator(\MacReportsKaratRow.grams, order: .reverse)]

    private var f: AnaFigures { c.figures }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                macReportsFigures(moneyFigures)
                Divider()
                macReportsFigures(flowFigures)
                Divider()
                trend
                HStack(alignment: .top, spacing: 0) {
                    facts.frame(maxWidth: .infinity, alignment: .topLeading)
                    if c.showCosts {
                        Divider()
                        expenses.frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    Divider()
                    gold.frame(maxWidth: .infinity, alignment: .topLeading)
                }
                Divider()
                notes
            }
        }
    }

    // MARK: The figures

    private func fig(_ label: String, _ value: String, _ now: Double, _ before: Double?, up: Bool = true,
                     plain: String? = nil, tone: Tone? = nil) -> MacFigure {
        MacReportsChange.figure(label, value, now: now, before: before, words: c.words, upIsGood: up, plain: plain, tone: tone)
    }

    private var net: Double { AnaNet.profit(estimated: f.estProfit, expenses: f.totalExpenses) }

    private var moneyFigures: [MacFigure] {
        let p = c.previous
        var out: [MacFigure] = []
        out.append(fig("Revenue", Money.pkrLac(f.totalSales), f.totalSales, p?.totalSales, plain: "Sales in this period"))
        guard c.showCosts else { return out }
        out.append(fig("Expenses", Money.pkrLac(f.totalExpenses), f.totalExpenses, p?.totalExpenses, up: false, plain: "Paid out in this period"))
        out.append(fig("Estimated profit", Money.pkrLac(f.estProfit), f.estProfit, p?.estProfit, plain: estDetail))
        let prevNet: Double? = p.map { AnaNet.profit(estimated: $0.estProfit, expenses: $0.totalExpenses) }
        let netTone: Tone? = net < 0 ? Tone.owed : nil
        out.append(fig("Net profit", Money.pkrLac(net), net, prevNet, plain: netDetail, tone: netTone))
        return out
    }

    private var flowFigures: [MacFigure] {
        let p = c.previous
        var out: [MacFigure] = []
        out.append(fig("Orders", String(f.totalOrders), Double(f.totalOrders), p.map { Double($0.totalOrders) }))
        out.append(fig("Average order", Money.pkrLac(f.averageOrderValue), f.averageOrderValue, p?.averageOrderValue))
        out.append(fig("Items sold", AnaFormat.count(f.totalItemsSold), f.totalItemsSold, p?.totalItemsSold))
        out.append(fig("Cash in", Money.pkrLac(f.cashIn), f.cashIn, p?.cashIn))
        guard c.showCosts else { return out }
        out.append(fig("Cash out", Money.pkrLac(f.cashOut), f.cashOut, p?.cashOut, up: false, plain: "Every expense paid"))
        let flow = f.netCashFlow
        let flowTone: Tone? = flow < 0 ? Tone.owed : nil
        let sign = flow >= 0 ? "+" : "\u{2212}"
        out.append(fig("Net cash flow", sign + Money.pkrLac(abs(flow)), flow, p?.netCashFlow,
                       plain: flow >= 0 ? "Gained cash" : "Spent more than came in", tone: flowTone))
        return out
    }

    private var assumedPercent: Int { Int((House.margin.assumedMargin * 100).rounded()) }

    /// The house costs by gold only when it has a ratti figure and at least one sale had its 24k rate.
    private var costedByGold: Bool { House.margin.rattiLess != nil && f.salesCosted > 0 }

    private var estDetail: String {
        guard costedByGold, f.totalSales > 0 else { return "Revenue × \(assumedPercent)%" }
        let pct = (f.estProfit / f.totalSales * 1000).rounded() / 10
        return "\(AnaFormat.number(pct, maxDigits: 1))% of revenue"
    }

    private var netDetail: String {
        guard f.totalSales > 0 else { return "No revenue in period" }
        return "\(AnaFormat.fixed(AnaNet.marginPercent(net: net, revenue: f.totalSales), 1))% margin"
    }

    private var estNote: String {
        guard costedByGold else { return "Estimated profit is revenue × \(assumedPercent)%, before expenses." }
        return "Estimated profit: \(f.salesCosted) of \(f.salesCount) sales from their 24k rate, the rest at \(assumedPercent)%, before expenses."
    }

    // MARK: The chart

    @ViewBuilder
    private var trend: some View {
        if !f.salesOverTime.isEmpty {
            MacReportsHeader(title: "Revenue over time", detail: nil)
            AnaRevenueBars(days: f.salesOverTime)
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            Divider()
        }
    }

    // MARK: Revenue and cash

    private var facts: some View {
        VStack(alignment: .leading, spacing: 0) {
            MacReportsFacts(title: "Revenue and pieces", detail: nil, rows: revenueFacts)
            MacReportsFacts(title: "Cash in made of", detail: Money.pkrLac(f.cashIn), rows: cashFacts)
        }
        .padding(.bottom, 8)
    }

    private var revenueFacts: [MacReportsFact] {
        var rows: [MacReportsFact] = []
        rows.append(MacReportsFact("Invoices", Money.pkrLac(f.invoiceSales)))
        rows.append(MacReportsFact("Orders", Money.pkrLac(f.orderSales)))
        rows.append(MacReportsFact("Extra revenue", Money.pkrLac(f.extraRevenue)))
        if f.totalUnpaid > 0 { rows.append(MacReportsFact("Outstanding", Money.pkrLac(f.totalUnpaid), tone: .owed)) }
        rows.append(MacReportsFact("Discounts", Money.pkrLac(f.totalDiscounts)))
        rows.append(MacReportsFact("Items per order", AnaFormat.fixed(f.averageItemsPerOrder, 2)))
        return rows
    }

    /// What the cash in was made of: invoice payments always, the rest when there was any.
    private var cashFacts: [MacReportsFact] {
        guard let cash = f.cash else { return [MacReportsFact("Invoice payments", Money.pkrLac(0))] }
        var rows: [MacReportsFact] = [MacReportsFact("Invoice payments", Money.pkrLac(cash.invoicePayments))]
        if cash.orderAdvances > 0 { rows.append(MacReportsFact("Order advances", Money.pkrLac(cash.orderAdvances))) }
        if cash.exchange > 0 { rows.append(MacReportsFact("Exchange", Money.pkrLac(cash.exchange))) }
        if cash.extraRevenue > 0 { rows.append(MacReportsFact("Extra revenue", Money.pkrLac(cash.extraRevenue))) }
        return rows
    }

    // MARK: Expenses

    private var expenseRows: [MacReportsExpenseRow] {
        let total = f.expensesByCategory.reduce(0.0) { (sum: Double, e: AnaExpenseCategory) -> Double in sum + e.amount }
        return f.expensesByCategory
            .map { (e: AnaExpenseCategory) -> MacReportsExpenseRow in
                MacReportsExpenseRow(id: e.category, category: e.category, amount: e.amount, share: total > 0 ? e.amount / total : 0)
            }
            .sorted(using: expenseSort)
    }

    private var expenses: some View {
        let rows = expenseRows
        return VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Expenses by category", detail: rows.isEmpty ? nil : Money.pkrLac(f.totalExpenses))
            if rows.isEmpty {
                Text("No expenses recorded for the selected period.")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            } else {
                Table(rows, sortOrder: $expenseSort) {
                    TableColumn("Category", value: \.category)
                    TableColumn("Amount", value: \.amount) { (r: MacReportsExpenseRow) in MacReportsNumber(Money.pkr(r.amount)) }
                        .width(min: 90, ideal: 110)
                    TableColumn("Share", value: \.share) { (r: MacReportsExpenseRow) in
                        MacReportsNumber(AnaFormat.fixed(r.share * 100, 1) + "%")
                    }
                    .width(min: 56, ideal: 64)
                }
                .scrollDisabled(true)
                .frame(height: 36 + 26 * CGFloat(rows.count))
            }
        }
    }

    // MARK: Gold and coins

    private var karatRows: [MacReportsKaratRow] {
        f.goldByKarat
            .map { (k: AnaKarat) -> MacReportsKaratRow in
                MacReportsKaratRow(id: k.karat, karat: k.karat.uppercased(), tola: AnaFormat.tola(k.grams), grams: k.grams, pieces: k.pieces)
            }
            .sorted(using: karatSort)
    }

    private var gold: some View {
        let rows = karatRows
        return VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Gold sold", detail: f.goldGrams > 0 ? AnaFormat.number(AnaFormat.tola(f.goldGrams), maxDigits: 3) + " tola" : nil)
            if rows.isEmpty {
                Text("No gold sold in this period.")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            } else {
                Table(rows, sortOrder: $karatSort) {
                    TableColumn("Karat", value: \.karat)
                        .width(min: 50, ideal: 60)
                    TableColumn("Tola", value: \.tola) { (r: MacReportsKaratRow) in
                        MacReportsNumber(AnaFormat.number(r.tola, maxDigits: 3))
                    }
                    .width(min: 60, ideal: 76)
                    TableColumn("Grams", value: \.grams) { (r: MacReportsKaratRow) in
                        MacReportsNumber(AnaFormat.number(r.grams, maxDigits: 2))
                    }
                    .width(min: 60, ideal: 76)
                    TableColumn("Pieces", value: \.pieces) { (r: MacReportsKaratRow) in MacReportsNumber(AnaFormat.count(r.pieces)) }
                        .width(min: 50, ideal: 60)
                }
                .scrollDisabled(true)
                .frame(height: 36 + 26 * CGFloat(rows.count))
            }
            coins
        }
    }

    /// A coin sells at the metal price plus a sliver; a ring carries making and margin. Nothing here is in the figures above.
    @ViewBuilder
    private var coins: some View {
        if f.coinInvoiceCount > 0 {
            let coin = f.coin
            MacReportsFacts(title: "Gold coins", detail: String(coin.invoices) + " " + AnaFormat.plural(coin.invoices, "bill", "bills"), rows: coinFacts)
            Text("Coin figures are separate from jewellery revenue and profit.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
        }
    }

    private var coinFacts: [MacReportsFact] {
        let coin = f.coin
        guard coin.invoices > 0 else { return [MacReportsFact("Coin bills", "None in this period")] }
        var rows: [MacReportsFact] = []
        rows.append(MacReportsFact("Coin revenue", Money.pkrLac(coin.revenue)))
        rows.append(MacReportsFact("Coins sold", AnaFormat.count(coin.coins)))
        rows.append(MacReportsFact("Weight", coin.grams > 0 ? AnaFormat.weight(coin.grams) : "No weight recorded"))
        rows.append(MacReportsFact("Realised per gram", coin.ratePerGram > 0 ? Money.pkrLac(coin.ratePerGram) : "—"))
        if coin.outstanding >= 1 { rows.append(MacReportsFact("Outstanding", Money.pkrLac(coin.outstanding), tone: .owed)) }
        return rows
    }

    // MARK: Notes

    private var notes: some View {
        let cash = f.cashIn
        // Gold taken off an invoice's total is in Cash In but was never in revenue.
        let gap = f.totalSales - (cash - f.exchangeOffInvoices)
        return VStack(alignment: .leading, spacing: 4) {
            if c.showCosts { Text(estNote) }
            Text("Cash flow counts money received and paid. Revenue also includes unpaid sales and open orders.")
            if gap > 0 {
                Text("\(Money.pkrLac(gap)) of recognised revenue is not yet collected: it sits as customer receivables and uninvoiced open orders.")
            }
            if !c.showCosts {
                Text("Expenses, extra revenue and what the shop earns are the owners’ books, so these figures are from sales and orders only.")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
}

struct MacReportsExpenseRow: Identifiable {
    let id: String
    let category: String
    let amount: Double
    let share: Double
}

struct MacReportsKaratRow: Identifiable {
    let id: String
    let karat: String
    let tola: Double
    let grams: Double
    let pieces: Double
}
#endif
