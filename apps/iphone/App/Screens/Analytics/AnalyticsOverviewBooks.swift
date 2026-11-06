import SwiftUI
import ERPCore

/// Analytics → Overview (src/components/analytics/pages/overview.tsx): "How is the shop doing?" in one glance. Four
/// headline figures against the period before, then a picture per question; every picture is a door to the page that
/// answers it in depth. No paragraphs: a card has one computed sentence and a small picture, and a card with nothing to
/// show is left out rather than drawn empty. What used to be explained above the numbers lives on the deep pages.
/// `Money.lacCrore` as a one-argument function (it has a default `digits`).
let abLac: (Double) -> String = { (v: Double) -> String in Money.lacCrore(v) }

struct AbOverviewScreen: View {
    var body: some View {
        AbHost(title: "Analytics", hub: true) { (ctx: AbCtx) in
            AbOverviewPage(ctx: ctx)
        }
    }
}

struct AbOverviewPage: View {
    let ctx: AbCtx
    @State private var monthlyPDF = false

    private var b: Books { ctx.books }

    var body: some View {
        VStack(alignment: .leading, spacing: pt(16)) {
            tiles
            AbGrid {
                salesCard
                profitCard
                cashCard
                categoryCard
                customerCard
                metalCard
                spendCard
                piecesCard
            }
        }
        .sheet(isPresented: $monthlyPDF) { AnaMonthlyReportSheet() }
        .toolbar {
            // The month's PDF is the ERP's own: any month, drawn by the server, the same document the 1st's WhatsApp report carries.
            ToolbarItem(placement: .trailingAction) {
                Button { monthlyPDF = true } label: {
                    Label("Monthly PDF", systemImage: "arrow.down.doc")
                }
            }
        }
    }

    // MARK: The four figures

    private var tiles: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: pt(12), alignment: .top)], alignment: .leading, spacing: pt(12)) {
            AbTile(label: "Revenue", value: Money.pkrLac(b.totalSales), path: "/analytics/sales",
                   delta: deltaOf(b.totalSales, ctx.prev?.totalSales), against: ctx.previousLabel)
            AbTile(label: "Net profit", value: Money.pkrLac(b.netProfit), path: "/analytics/profit",
                   delta: deltaOf(b.netProfit, ctx.prev?.netProfit), against: ctx.previousLabel,
                   sub: AnaFormat.fixed(b.netMargin, 0) + "% margin")
            AbTile(label: "Net cash", value: Money.pkrLac(b.netCashFlow), path: "/analytics/cash",
                   delta: deltaOf(b.netCashFlow, ctx.prev?.netCashFlow), against: ctx.previousLabel,
                   sub: "in " + Money.pkrLac(b.cashIn) + " · out " + Money.pkrLac(b.cashOut))
            AbTile(label: "Still to collect", value: Money.pkrLac(b.totalUnpaid), path: "/analytics/cash", tone: .owed)
        }
    }

    // MARK: Sales over time

    @ViewBuilder private var salesCard: some View {
        if !b.salesOverTime.isEmpty {
            let bucket = autoBucket(ctx.period, now: ctx.now)
            let current = bucketSeries(b.salesOverTime, bucket, range: ctx.period, now: ctx.now)
            let before: [BucketRow]? = ctx.prev.map { (p: Books) -> [BucketRow] in
                bucketSeries(p.salesOverTime, bucket, range: ctx.previousRange, now: ctx.now)
            }
            let best = b.salesOverTime.reduce(nil as SalesDay?) { (m: SalesDay?, d: SalesDay) -> SalesDay? in d.sales > (m?.sales ?? 0) ? d : m }
            AbCard(title: "Sales over time", takeaway: best.map { "Best day " + AbSay.day($0.date) + " · " + Money.pkrLac($0.sales) } ?? "No sales in this period",
                   path: "/analytics/sales") {
                AbTrend(rows: compareSeries(current, before), bucket: bucket, showPrev: ctx.previous != nil, height: 170, interactive: false)
            }
        }
    }

    // MARK: Revenue to profit

    @ViewBuilder private var profitCard: some View {
        if b.totalSales > 0 {
            let steps: [AbStep] = [
                AbStep(label: "Revenue", value: b.totalSales, total: true),
                AbStep(label: House.recordsGoods ? "Goods" : "Pieces cost", value: -max(0, b.costOfPieces), total: false),
                AbStep(label: House.recordsGoods ? "Gross profit" : "Profit", value: b.estProfitAdj, total: true),
                AbStep(label: "Running", value: -b.runningExpenses, total: false),
                AbStep(label: "Net profit", value: b.netProfit, total: true),
            ]
            let take = b.netProfit >= 0
                ? "Kept PKR " + String(Int(b.netMargin.rounded())) + " of every PKR 100"
                : "A loss of " + Money.pkrLac(-b.netProfit) + " after running costs"
            AbCard(title: "From revenue to profit", takeaway: take, path: "/analytics/profit") {
                AbWaterfall(steps: steps, height: 170, interactive: false)
            }
        }
    }

    // MARK: Money in and out

    @ViewBuilder private var cashCard: some View {
        if b.cashIn > 0 || b.cashOut > 0 {
            let net = (b.netCashFlow < 0 ? "−" : "") + Money.pkrLac(abs(b.netCashFlow))
            let ins: [AbPart] = [
                AbPart(id: "inv", label: "Invoice payments", value: b.cashInFromInvoicePayments, color: AbPalette.color(1)),
                AbPart(id: "adv", label: "Order advances", value: b.cashInFromOrderAdvances, color: AbPalette.color(2)),
                AbPart(id: "exc", label: "Exchange", value: b.cashInFromExchange, color: AbPalette.color(3)),
                AbPart(id: "ext", label: "Extra revenue", value: b.cashInFromExtraRevenue, color: AbPalette.color(4)),
            ]
            let outs: [AbPart] = [
                AbPart(id: "run", label: AbPalette.kindLabel(.running), value: b.cashOutRunning, color: AbPalette.kind(.running)),
                AbPart(id: "gds", label: AbPalette.kindLabel(.goods), value: b.cashOutGoods, color: AbPalette.kind(.goods)),
                AbPart(id: "drw", label: AbPalette.kindLabel(.drawings), value: b.cashOutDrawings, color: AbPalette.kind(.drawings)),
                AbPart(id: "cr", label: "Credit paid back", value: b.creditPaidBack, color: AbPalette.color(4)),
            ]
            AbCard(title: "Money in and out",
                   takeaway: Money.pkrLac(b.cashIn) + " in, " + Money.pkrLac(b.cashOut) + " out: net " + net,
                   path: "/analytics/cash") {
                VStack(alignment: .leading, spacing: pt(14)) {
                    captioned("In", ins, abLac)
                    captioned("Out", outs, abLac)
                }
            }
        }
    }

    /// A caption over a bar of shares.
    private func captioned(_ caption: String, _ parts: [AbPart], _ format: @escaping (Double) -> String) -> some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Text(caption).font(.footnote.weight(.medium))
            AbStack(parts: parts, format: format, interactive: false)
        }
    }

    // MARK: What sold

    @ViewBuilder private var categoryCard: some View {
        let cats = Array(b.salesByCategory.sorted { $0.sales > $1.sales }.prefix(5))
        let total = b.salesByCategory.reduce(0) { $0 + $1.sales }
        if let lead = cats.first, total > 0 {
            AbCard(title: "What sold", takeaway: lead.categoryName + " were " + String(AbSay.percent(lead.sales, total)) + "% of sales",
                   path: "/analytics/categories") {
                AbHBars(rows: cats.map { (c: CategorySale) -> AbHBar in
                    AbHBar(id: c.categoryId, label: c.categoryName, value: c.sales, valueText: Money.lacCrore(c.sales))
                }, interactive: false)
            }
        }
    }

    // MARK: Who bought

    @ViewBuilder private var customerCard: some View {
        let buyers = b.newCustomers + b.returningCustomers
        if buyers > 0 {
            let take = b.newCustomers > 0
                ? AbSay.count(b.newCustomers, "new customer") + " brought " + Money.pkrLac(b.revenueFromNew)
                : AbSay.count(b.returningCustomers, "returning customer") + " brought " + Money.pkrLac(b.revenueFromReturning) + ", none new"
            let topSource = b.sourceBreakdown.filter { $0.key != UNCLASSIFIED_KEY && $0.revenue > 0 }.max { $0.revenue < $1.revenue }
            AbCard(title: "Who bought", takeaway: take, path: "/analytics/customers") {
                VStack(alignment: .leading, spacing: pt(14)) {
                    captioned("Customers", [
                        AbPart(id: "new", label: "New", value: Double(b.newCustomers), color: AbPalette.color(1)),
                        AbPart(id: "ret", label: "Returning", value: Double(b.returningCustomers), color: AbPalette.color(2)),
                    ]) { (v: Double) -> String in String(Int(v)) }
                    captioned("Revenue", [
                        AbPart(id: "new", label: "New", value: b.revenueFromNew, color: AbPalette.color(1)),
                        AbPart(id: "ret", label: "Returning", value: b.revenueFromReturning, color: AbPalette.color(2)),
                    ], abLac)
                    if let topSource {
                        Text("Most came through " + topSource.label + " · " + Money.pkrLac(topSource.revenue))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: Metal sold

    @ViewBuilder private var metalCard: some View {
        let coins = b.coinSummary
        if b.metalGrams > 0 || coins.coins > 0 {
            let topKarat = b.metalByKarat.max { $0.grams < $1.grams }
            let take = b.metalGrams > 0
                ? AbSay.tola(b.metalGrams) + " left the shop" + (topKarat.map { ", mostly " + $0.karat } ?? "")
                : AbSay.count(Int(coins.coins), "coin") + " sold, no jewellery weighed"
            AbCard(title: AbSay.metalWord + " sold", takeaway: take, path: "/analytics/metal") {
                VStack(alignment: .leading, spacing: pt(10)) {
                    if b.metalGrams > 0 {
                        AbStack(parts: b.metalByKarat.map { (k: MetalKaratRow) -> AbPart in
                            AbPart(id: k.karat, label: k.karat.uppercased(), value: k.grams, color: AbPalette.karat(k.karat))
                        }, format: { (g: Double) -> String in AbSay.tola(g) }, interactive: false)
                    }
                    if coins.coins > 0 {
                        Text(AbSay.metalWord + " coins, apart: " + AbSay.count(Int(coins.coins), "coin") + " · " + AbSay.tola(coins.grams) + " · " + Money.pkrLac(coins.revenue))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: Where the money went

    @ViewBuilder private var spendCard: some View {
        let spend = Array(b.expensesByCategory.sorted { $0.amount > $1.amount }.prefix(5))
        if b.totalExpenses > 0, let lead = spend.first {
            AbCard(title: "Where the money went",
                   takeaway: Money.pkrLac(b.totalExpenses) + " spent, " + String(AbSay.percent(lead.amount, b.totalExpenses)) + "% on " + lead.category,
                   path: "/analytics/spending") {
                AbHBars(rows: spend.map { (e: ExpenseByCategory) -> AbHBar in
                    AbHBar(id: e.category, label: e.category, value: e.amount, valueText: Money.lacCrore(e.amount),
                           color: AbPalette.kind(e.kind), chip: AbPalette.kindLabel(e.kind).lowercased())
                }, interactive: false)
            }
        }
    }

    // MARK: Best pieces

    @ViewBuilder private var piecesCard: some View {
        let pieces = Array(b.topProductsByRevenue.prefix(5))
        if let lead = pieces.first {
            AbCard(title: "Best pieces", takeaway: lead.name + " led with " + Money.pkrLac(lead.revenue), path: "/analytics/products") {
                AbHBars(rows: pieces.map { (p: TopProduct) -> AbHBar in
                    AbHBar(id: p.sku, label: p.name, value: p.revenue, valueText: Money.lacCrore(p.revenue))
                }, interactive: false)
            }
        }
    }
}
