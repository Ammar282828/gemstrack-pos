import SwiftUI
import ERPCore

/// Analytics → Overview (analytics-view.tsx, section "overview"): how the shop is doing in the period.
/// The money figures first, the counts beneath, the gold by weight, the coins on their own, the cash
/// that actually moved, and what the expenses were. Est. profit, expenses and the cash out side are the
/// owners' books: a staff account that reaches this page sees the sales side alone.
struct AnaOverviewPage: View {
    let figures: AnaFigures
    let bar: AnaPeriodBar
    let showCosts: Bool
    @State private var monthlyPDF = false

    var body: some View {
        List {
            Section {
                bar
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            moneySection
            trendSection
            countsSection
            goldSection
            coinsSection
            cashSection
            expensesSection
            staffNote
        }
        .listStyle(.insetGrouped)
        .sheet(isPresented: $monthlyPDF) { AnaMonthlyReportSheet() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                // The month's PDF is the ERP's own: any month, drawn by the server, the same document the 1st's WhatsApp report carries.
                if showCosts {
                    Button { monthlyPDF = true } label: {
                        Label("Monthly PDF", systemImage: "arrow.down.doc")
                    }
                }
            }
        }
    }

    // MARK: Money

    private var moneySection: some View {
        Section {
            tiles
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            DisclosureGroup("Revenue and profit details") {
                LabeledContent("Invoices") { Text(Money.pkrLac(figures.invoiceSales)).monospacedDigit() }
                LabeledContent("Orders") { Text(Money.pkrLac(figures.orderSales)).monospacedDigit() }
                LabeledContent("Extra revenue") { Text(Money.pkrLac(figures.extraRevenue)).monospacedDigit() }
                if showCosts { Text(estNote).font(.footnote).foregroundStyle(.secondary) }
            }
        }.houseRows()
    }

    private var tiles: some View {
        let f = figures
        let net = f.totalSales - f.totalExpenses
        let netPct = f.totalSales > 0 ? net / f.totalSales * 100 : 0
        let netDetail = f.totalSales > 0 ? "\(AnaFormat.fixed(netPct, 1))% margin" : "No revenue in period"
        let netTint: Color = net >= 0 ? Color.green : Color.red
        return VStack(spacing: 10) {
            FigureRow(alignment: .top, spacing: 10) {
                FigureTile(label: "Revenue", value: Money.pkrLac(f.totalSales), detail: "Sales in this period", tint: Color.green)
                if showCosts {
                    FigureTile(label: "Expenses", value: Money.pkrLac(f.totalExpenses), detail: "Paid out in this period", tint: Color.red)
                }
            }
            if showCosts {
                FigureRow(alignment: .top, spacing: 10) {
                    FigureTile(label: "Est. profit", value: Money.pkrLac(f.estProfit), detail: estDetail, tint: Theme.accent)
                    FigureTile(label: "Net profit", value: Money.pkrLac(net), detail: netDetail, tint: netTint)
                }
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder private var trendSection: some View {
        if !figures.salesOverTime.isEmpty {
            LedgerSection("Revenue over time") {
                AnaRevenueBars(days: figures.salesOverTime)
                NavigationLink(value: Route(path: "/analytics/sales")) { Label("Sales details", systemImage: "chart.bar") }
            }
        }
    }

    /// "Invoices 4.5 lac · Orders 1 lac · Extra 10,000".
    private var revenueDetail: String {
        let f = figures
        var parts: [String] = ["Invoices \(Money.pkrLac(f.invoiceSales))"]
        if f.orderSales > 0 { parts.append("Orders \(Money.pkrLac(f.orderSales))") }
        if f.extraRevenue > 0 { parts.append("Extra \(Money.pkrLac(f.extraRevenue))") }
        return parts.joined(separator: " · ")
    }

    private var assumedPercent: Int { Int((House.margin.assumedMargin * 100).rounded()) }

    /// The house costs by gold only when it has a ratti figure and at least one sale had its 24k rate.
    private var costedByGold: Bool { House.margin.rattiLess != nil && figures.salesCosted > 0 }

    private var estDetail: String {
        let f = figures
        guard costedByGold, f.totalSales > 0 else { return "Revenue × \(assumedPercent)%" }
        let pct = (f.estProfit / f.totalSales * 1000).rounded() / 10
        return "\(AnaFormat.number(pct, maxDigits: 1))% of revenue"
    }

    private var estNote: String {
        let f = figures
        guard costedByGold else { return "Est. profit is revenue × \(assumedPercent)%, before expenses." }
        return "Est. profit: \(f.salesCosted) of \(f.salesCount) sales from their 24k rate, the rest at \(assumedPercent)%, before expenses."
    }

    // MARK: Counts

    private var countsSection: some View {
        let f = figures
        return LedgerSection("Orders and pieces", collapsible: true) {
            if f.totalUnpaid > 0 {
                LabeledContent("Outstanding") {
                    Text(Money.pkrLac(f.totalUnpaid)).monospacedDigit().foregroundStyle(Color.orange)
                }
            }
            LabeledContent("Orders", value: String(f.totalOrders))
            LabeledContent("Avg. order") { Text(Money.pkrLac(f.averageOrderValue)).monospacedDigit() }
            LabeledContent("Items sold", value: AnaFormat.count(f.totalItemsSold))
            LabeledContent("Discounts") { Text(Money.pkrLac(f.totalDiscounts)).monospacedDigit() }
            LabeledContent("Items / order", value: AnaFormat.fixed(f.averageItemsPerOrder, 2))
        }
        .houseRows()
    }

    // MARK: Gold sold, by weight

    /// Rupees move with the rate; grams do not, and grams are what the shop actually parted with.
    /// Both units, because the trade quotes in tola and the scale reads in grams.
    @ViewBuilder private var goldSection: some View {
        let f = figures
        if f.goldGrams > 0 {
            let tolaText = AnaFormat.number(AnaFormat.tola(f.goldGrams), maxDigits: 3) + " tola"
            let grams = AnaFormat.number(f.goldGrams, maxDigits: 2) + " g · " + AnaFormat.count(f.goldPieces)
            let noun = f.goldPieces == 1 ? " piece" : " pieces"
            let weighed = grams + noun + " weighed"
            Section {
                LabeledContent("Total") {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(tolaText)
                            .fontWeight(.semibold)
                            .monospacedDigit()
                        Text(weighed)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                DisclosureGroup("By karat") {
                ForEach(f.goldByKarat) { (k: AnaKarat) in
                    LabeledContent(k.karat.uppercased()) {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(AnaFormat.number(AnaFormat.tola(k.grams), maxDigits: 3) + " tola").monospacedDigit()
                            Text(AnaFormat.number(k.grams, maxDigits: 2) + " g · " + AnaFormat.count(k.pieces))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                }
            } header: {
                LedgerHeading(title: "Gold sold")
            }
            .houseRows()
        }
    }

    // MARK: Gold coins, on their own

    /// A coin sells at the metal price plus a sliver; a ring carries making and margin. Nothing in this
    /// section is in the figures above.
    @ViewBuilder private var coinsSection: some View {
        let f = figures
        if f.coinInvoiceCount > 0 {
            let c = f.coin
            let bills = String(c.invoices) + " " + AnaFormat.plural(c.invoices, "bill", "bills") + " in this period"
            Section {
                if c.invoices > 0 {
                    TwoLine(title: "Coin revenue", subtitle: bills, trailing: Money.pkrLac(c.revenue))
                    DisclosureGroup("Coin details") {
                    TwoLine(title: "Coins sold",
                            subtitle: c.grams > 0 ? AnaFormat.weight(c.grams) : "No weight recorded",
                            trailing: AnaFormat.count(c.coins))
                    TwoLine(title: "Realised / gram",
                            subtitle: "Revenue over grams, all-in",
                            trailing: c.ratePerGram > 0 ? Money.pkrLac(c.ratePerGram) : "—")
                    if c.outstanding > 0 {
                        TwoLine(title: "Outstanding",
                                subtitle: "Still owed on coin bills",
                                trailing: Money.pkrLac(c.outstanding),
                                trailingTint: Color.orange)
                    }
                    Text("Coin figures are separate from jewellery revenue and profit.").font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Text("No coin bills in this period.").foregroundStyle(.secondary)
                }
            } header: {
                LedgerHeading(title: "Gold coins")
            }
            .houseRows()
        }
    }

    // MARK: Cash flow

    /// Actual money in against out during the period. Revenue counts what was earned, including future
    /// cash from open orders and unpaid invoices; cash flow counts only what physically moved.
    private var cashSection: some View {
        let f = figures
        let net = f.netCashFlow
        // Gold taken off an invoice's total is in Cash In but was never in revenue.
        let gap = f.totalSales - (f.cashIn - f.exchangeOffInvoices)
        let netSign = net >= 0 ? "+" : "−"
        let netTint: Color = net >= 0 ? Color.green : Color.red
        return Section {
            TwoLine(title: "Cash in", trailing: Money.pkrLac(f.cashIn), trailingTint: Color.green)
            if showCosts {
                TwoLine(title: "Cash out", subtitle: "Every expense paid in this period",
                        trailing: Money.pkrLac(f.cashOut), trailingTint: Color.red)
                TwoLine(title: "Net cash flow",
                        subtitle: net >= 0 ? "Business gained cash in this period" : "Business spent more cash than it took in",
                        trailing: netSign + Money.pkrLac(abs(net)), trailingTint: netTint)
            }
            DisclosureGroup("Cash breakdown") {
            ForEach(cashInParts) { (p: AnaCashPart) in
                LabeledContent(p.label) { Text(Money.pkrLac(p.amount)).monospacedDigit() }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if gap > 0 {
                Text("\(Money.pkrLac(gap)) of recognised revenue is not yet collected: it sits as customer receivables and uninvoiced open orders. That gap is the difference between revenue (what was earned) and Cash in, leaving out gold taken off a bill (it is off the revenue too).")
                    .font(.footnote)
                    .foregroundStyle(Color.orange)
            }
                Text("Cash flow counts money received and paid. Revenue also includes unpaid sales and open orders.").font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            LedgerHeading(title: "Cash flow")
        }
        .houseRows()
    }

    /// What the cash in was made of: invoice payments always, the rest when there was any.
    private struct AnaCashPart: Identifiable {
        let label: String
        let amount: Double
        var id: String { label }
    }

    private var cashInParts: [AnaCashPart] {
        guard let cash = figures.cash else { return [AnaCashPart(label: "Invoice payments", amount: 0)] }
        var parts: [AnaCashPart] = [AnaCashPart(label: "Invoice payments", amount: cash.invoicePayments)]
        if cash.orderAdvances > 0 { parts.append(AnaCashPart(label: "Order advances", amount: cash.orderAdvances)) }
        if cash.exchange > 0 { parts.append(AnaCashPart(label: "Exchange", amount: cash.exchange)) }
        if cash.extraRevenue > 0 { parts.append(AnaCashPart(label: "Extra revenue", amount: cash.extraRevenue)) }
        return parts
    }

    // MARK: Expenses by category

    @ViewBuilder private var expensesSection: some View {
        if showCosts {
            let rows = figures.expensesByCategory
            Section {
                if rows.isEmpty {
                    Text("No expenses recorded for the selected period.").foregroundStyle(.secondary)
                } else {
                    AnaBarChart(bars: bars(rows), tint: Color.red.opacity(0.8))
                    DisclosureGroup("All categories · \(rows.count)") {
                        ForEach(rows) { (e: AnaExpenseCategory) in
                            LabeledContent(e.category) { Text(Money.pkr(e.amount)).monospacedDigit() }
                        }
                    }
                }
            } header: {
                LedgerHeading(title: "Expenses by category")
            }
            .houseRows()
        }
    }

    private func bars(_ rows: [AnaExpenseCategory]) -> [AnaBar] {
        rows.map { (e: AnaExpenseCategory) -> AnaBar in AnaBar(id: e.category, label: e.category, value: e.amount) }
    }

    @ViewBuilder private var staffNote: some View {
        if !showCosts {
            Section {
                Text("Expenses, extra revenue and what the shop earns are the owners’ books, so these figures are from sales and orders only.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .houseRows()
        }
    }
}

/// The server draws the same monthly document used by the ERP’s scheduled report.
private struct AnaMonthlyReportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selected = 1
    @State private var opened = false
    private var months: [Date] {
        let calendar = AnaDate.karachi
        let start = calendar.date(from: calendar.dateComponents([.year, .month], from: Date())) ?? Date()
        return (0..<24).compactMap { calendar.date(byAdding: .month, value: -$0, to: start) }
    }
    private func key(_ date: Date) -> String {
        let c = AnaDate.karachi.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", c.year ?? 2000, c.month ?? 1)
    }
    private func label(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.calendar = AnaDate.karachi
        formatter.timeZone = ERPDate.karachi; formatter.dateFormat = "MMMM yyyy"
        return formatter.string(from: date)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Month", selection: $selected) {
                        ForEach(Array(months.enumerated()), id: \.offset) { index, month in
                            Text(label(month) + (index == 0 ? " · so far" : "")).tag(index)
                        }
                    }
                    Button("Open report") { opened = true }.buttonStyle(.houseProminent)
                }.houseRows()
            }
            .modifier(HouseGround()).navigationTitle("Monthly PDF").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $opened) {
                PDFDocumentScreen(path: "/api/reports/monthly?month=" + key(months[selected]), fileName: "monthly-report-" + key(months[selected]) + ".pdf", title: label(months[selected]))
            }
        }.presentationDetents([.medium, .large])
    }
}
