#if os(macOS)
import SwiftUI
import ERPCore

// Analytics › Products, Customers and Categories on the Mac: the figures with their change, then every row of the breakdown
// as a sortable table (no "Show top 10", no sort chips). The revenue here is each piece's own total, before invoice
// discounts and trade-ins, so it runs higher than the Overview's net figure (the note says so under the table).

/// Where a row opens: a stock piece's own page, by its SKU (the address the Stock list opens).
private enum MacReportsPaths {
    static func piece(_ sku: String) -> String {
        let allowed = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))
        return "/products/" + (sku.addingPercentEncoding(withAllowedCharacters: allowed) ?? sku)
    }
}

/// The small print under a table.
private struct MacReportsNote: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
    }
}

// MARK: - Products

struct MacReportsProducts: View {
    let c: MacReportsContext

    @State private var search = ""
    @State private var selection = Set<String>()
    @State private var sort = [KeyPathComparator(\MacReportsProductRow.revenue, order: .reverse)]
    @State private var base = Memo<[MacReportsProductRow]>()
    @State private var before = Memo<[MacReportsProductRow]>()
    @State private var made = Memo<[MacReportsProductRow]>()

    private func rows(_ breakdown: [AnaBreakdown.ProductRow]) -> [MacReportsProductRow] {
        let total = breakdown.reduce(0.0) { (sum: Double, p: AnaBreakdown.ProductRow) -> Double in sum + p.revenue }
        return breakdown.map { (p: AnaBreakdown.ProductRow) -> MacReportsProductRow in
            MacReportsProductRow(id: p.sku, name: p.name, sku: AnaSku.isStock(p.sku) ? p.sku : "Not in stock", stock: AnaSku.isStock(p.sku),
                                 quantity: p.quantity, sales: p.orders, revenue: p.revenue, share: total > 0 ? p.revenue / total : 0)
        }
    }

    private var allRows: [MacReportsProductRow] {
        base(c.key) { rows(AnaBreakdown.products(c.books, range: c.range)) }
    }

    private var earlierRows: [MacReportsProductRow]? {
        guard let other = c.previousRange else { return nil }
        return before(c.previousKey) { rows(AnaBreakdown.products(c.books, range: other)) }
    }

    private func shown(_ all: [MacReportsProductRow]) -> [MacReportsProductRow] {
        made(c.key + [search.hashValue, sort.hashValue]) {
            let term = search.trimmingCharacters(in: .whitespaces).lowercased()
            let matched: [MacReportsProductRow] = term.isEmpty ? all : all.filter { (p: MacReportsProductRow) -> Bool in
                p.name.lowercased().contains(term) || p.sku.lowercased().contains(term)
            }
            return matched.sorted(using: sort)
        }
    }

    var body: some View {
        let all = allRows
        let list = shown(all)
        // The page of every Analytics place: centred, 1400 points at most, the same gutters as Today. The table's card takes the
        // rest of the height and the table scrolls inside it.
        VStack(alignment: .leading, spacing: 20) {
            macReportsFigures(figureList(all))
            MacReportsCard {
                MacReportsHeader(title: "Pieces sold", detail: "\(list.count)")
                table(list)
                MacReportsNote(text: "Revenue here is each piece’s own total, before invoice discounts and trade-ins, so it runs higher than the Overview’s net figure.")
            }
        }
        .padding(24)
        .frame(maxWidth: 1400, alignment: .leading)
        .frame(maxWidth: .infinity)
        .background(Theme.ground)
        .macSummaryBar(summary(all, list))
        .macSearchable(text: $search, prompt: "Search every piece by name or SKU")
    }

    private static func revenue(_ rows: [MacReportsProductRow]) -> Double {
        rows.reduce(0.0) { (sum: Double, p: MacReportsProductRow) -> Double in sum + p.revenue }
    }

    private static func pieces(_ rows: [MacReportsProductRow]) -> Double {
        rows.reduce(0.0) { (sum: Double, p: MacReportsProductRow) -> Double in sum + p.quantity }
    }

    private func figureList(_ all: [MacReportsProductRow]) -> [MacFigure] {
        let earlier = earlierRows
        let revenue = Self.revenue(all)
        let pieces = Self.pieces(all)
        let wasRevenue: Double? = earlier.map { Self.revenue($0) }
        let wasPieces: Double? = earlier.map { Self.pieces($0) }
        let wasKinds: Double? = earlier.map { Double($0.count) }
        var out: [MacFigure] = []
        out.append(MacReportsChange.figure("Revenue", Money.pkrLac(revenue), now: revenue, before: wasRevenue, words: c.words))
        out.append(MacReportsChange.figure("Pieces sold", AnaFormat.count(pieces), now: pieces, before: wasPieces, words: c.words))
        out.append(MacReportsChange.figure("Different pieces", String(all.count), now: Double(all.count), before: wasKinds, words: c.words))
        return out
    }

    private func summary(_ all: [MacReportsProductRow], _ list: [MacReportsProductRow]) -> [String] {
        let picked = list.filter { selection.contains($0.id) }
        if !picked.isEmpty {
            return ["\(picked.count) selected", AnaFormat.count(Self.pieces(picked)) + " sold", Money.pkrLac(Self.revenue(picked))]
        }
        let count = list.count == all.count ? "\(all.count) pieces" : "\(list.count) of \(all.count) pieces"
        return [count, AnaFormat.count(Self.pieces(list)) + " sold", Money.pkrLac(Self.revenue(list))]
    }

    private func table(_ list: [MacReportsProductRow]) -> some View {
        Table(list, selection: $selection, sortOrder: $sort) {
            TableColumn("Piece", value: \.name) { (r: MacReportsProductRow) in Text(r.name).lineLimit(1) }
                .width(min: 120, ideal: 200)
            TableColumn("SKU", value: \.sku) { (r: MacReportsProductRow) in
                Text(r.sku).monospacedDigit().lineLimit(1).foregroundStyle(r.stock ? Color.primary : Color.secondary)
            }
            .width(min: 70, ideal: 100)
            TableColumn("Quantity", value: \.quantity) { (r: MacReportsProductRow) in MacReportsNumber(AnaFormat.count(r.quantity)) }
                .width(min: 56, ideal: 70)
            TableColumn("Sales", value: \.sales) { (r: MacReportsProductRow) in MacReportsNumber(String(r.sales)) }
                .width(min: 40, ideal: 56)
            TableColumn("Revenue", value: \.revenue) { (r: MacReportsProductRow) in MacAmount(r.revenue) }
                .width(min: 70, ideal: 90)
            TableColumn("Share", value: \.share) { (r: MacReportsProductRow) in
                MacReportsNumber(AnaFormat.fixed(r.share * 100, 1) + "%")
            }
            .width(min: 50, ideal: 60)
        }
        .macOpenSelection { (id: String) -> String? in
            // A piece described for one bill has no page; a stock piece opens in its own window.
            AnaSku.isStock(id) ? MacReportsPaths.piece(id) : nil
        }
        .scrollContentBackground(.hidden)
        .overlay {
            if list.isEmpty { Text("No pieces sold in this period.").foregroundStyle(.secondary) }
        }
    }
}

struct MacReportsProductRow: Identifiable {
    let id: String
    let name: String
    let sku: String
    let stock: Bool
    let quantity: Double
    let sales: Int
    let revenue: Double
    let share: Double
}

// MARK: - Customers

struct MacReportsCustomers: View {
    let c: MacReportsContext

    @State private var search = ""
    @State private var selection = Set<String>()
    @State private var sort = [KeyPathComparator(\MacReportsCustomerRow.spent, order: .reverse)]
    @State private var sourceSort = [KeyPathComparator(\MacReportsSourceRow.revenue, order: .reverse)]
    @State private var sourceMade = Memo<[MacReportsSourceRow]>()
    @State private var base = Memo<[MacReportsCustomerRow]>()
    @State private var before = Memo<[MacReportsCustomerRow]>()
    @State private var made = Memo<[MacReportsCustomerRow]>()

    private func rows(_ breakdown: [AnaBreakdown.CustomerRow]) -> [MacReportsCustomerRow] {
        breakdown.map { (r: AnaBreakdown.CustomerRow) -> MacReportsCustomerRow in
            MacReportsCustomerRow(id: r.key, customerId: r.customerId, name: r.name, sales: r.orderCount, pieces: r.itemsPurchased,
                                  average: r.averageSpent, spent: r.totalSpent)
        }
    }

    private var allRows: [MacReportsCustomerRow] {
        base(c.key) { rows(AnaBreakdown.customers(c.books, range: c.range)) }
    }

    private var earlierRows: [MacReportsCustomerRow]? {
        guard let other = c.previousRange else { return nil }
        return before(c.previousKey) { rows(AnaBreakdown.customers(c.books, range: other)) }
    }

    private func shown(_ all: [MacReportsCustomerRow]) -> [MacReportsCustomerRow] {
        made(c.key + [search.hashValue, sort.hashValue]) {
            let term = search.trimmingCharacters(in: .whitespaces).lowercased()
            let matched: [MacReportsCustomerRow] = term.isEmpty ? all : all.filter { (r: MacReportsCustomerRow) -> Bool in
                r.name.lowercased().contains(term)
            }
            return matched.sorted(using: sort)
        }
    }

    var body: some View {
        let all = allRows
        let list = shown(all)
        VStack(alignment: .leading, spacing: 20) {
            macReportsFigures(figureList(all))
            MacReportsCard { sources }
                .frame(minHeight: 200, maxHeight: 330)
            MacReportsCard {
                MacReportsHeader(title: "Everyone who bought", detail: "\(list.count)")
                table(list)
            }
            .frame(minHeight: 240, maxHeight: .infinity)
        }
        .padding(24)
        .frame(maxWidth: 1400, alignment: .leading)
        .frame(maxWidth: .infinity)
        .background(Theme.ground)
        .macSummaryBar(summary(all, list))
        .macSearchable(text: $search, prompt: "Search everyone by name")
    }

    private static func revenue(_ rows: [MacReportsCustomerRow]) -> Double {
        rows.reduce(0.0) { (sum: Double, r: MacReportsCustomerRow) -> Double in sum + r.spent }
    }

    private static func sales(_ rows: [MacReportsCustomerRow]) -> Double {
        rows.reduce(0.0) { (sum: Double, r: MacReportsCustomerRow) -> Double in sum + Double(r.sales) }
    }

    private static func average(_ rows: [MacReportsCustomerRow]) -> Double {
        let n = sales(rows)
        return n > 0 ? revenue(rows) / n : 0
    }

    private func figureList(_ all: [MacReportsCustomerRow]) -> [MacFigure] {
        let earlier = earlierRows
        let revenue = Self.revenue(all)
        let sales = Self.sales(all)
        let wasCount: Double? = earlier.map { Double($0.count) }
        let wasRevenue: Double? = earlier.map { Self.revenue($0) }
        let wasSales: Double? = earlier.map { Self.sales($0) }
        let wasAverage: Double? = earlier.map { Self.average($0) }
        var out: [MacFigure] = []
        out.append(MacReportsChange.figure("Customers", String(all.count), now: Double(all.count), before: wasCount, words: c.words))
        out.append(MacReportsChange.figure("Revenue", Money.pkrLac(revenue), now: revenue, before: wasRevenue, words: c.words))
        out.append(MacReportsChange.figure("Sales", AnaFormat.count(sales), now: sales, before: wasSales, words: c.words))
        out.append(MacReportsChange.figure("Average sale", Money.pkrLac(Self.average(all)), now: Self.average(all), before: wasAverage, words: c.words))
        return out
    }

    private func summary(_ all: [MacReportsCustomerRow], _ list: [MacReportsCustomerRow]) -> [String] {
        let picked = list.filter { selection.contains($0.id) }
        let chosen = picked.isEmpty ? list : picked
        let head: String
        if !picked.isEmpty {
            head = "\(picked.count) selected"
        } else if list.count == all.count {
            head = "\(all.count) customers"
        } else {
            head = "\(list.count) of \(all.count) customers"
        }
        return [head, Money.pkrLac(Self.revenue(chosen))]
    }

    private func table(_ list: [MacReportsCustomerRow]) -> some View {
        Table(list, selection: $selection, sortOrder: $sort) {
            TableColumn("Customer", value: \.name) { (r: MacReportsCustomerRow) in Text(r.name).lineLimit(1) }
                .width(min: 120, ideal: 200)
            TableColumn("Sales", value: \.sales) { (r: MacReportsCustomerRow) in MacReportsNumber(String(r.sales)) }
                .width(min: 40, ideal: 56)
            TableColumn("Pieces", value: \.pieces) { (r: MacReportsCustomerRow) in MacReportsNumber(AnaFormat.count(r.pieces)) }
                .width(min: 40, ideal: 56)
            TableColumn("Average sale", value: \.average) { (r: MacReportsCustomerRow) in MacAmount(r.average) }
                .width(min: 70, ideal: 90)
            TableColumn("Spent", value: \.spent) { (r: MacReportsCustomerRow) in MacAmount(r.spent) }
                .width(min: 70, ideal: 90)
        }
        .macOpenSelection { (key: String) -> String? in
            // Someone in the book opens in a window; a walk-in or a name alone has no page.
            list.first(where: { $0.id == key })?.customerId.map { AnaPath.customer($0) }
        }
        .scrollContentBackground(.hidden)
        .overlay {
            if list.isEmpty { Text("No customer data for this period.").foregroundStyle(.secondary) }
        }
    }

    // MARK: Acquisition source

    private var sourceRows: [MacReportsSourceRow] {
        sourceMade(c.key + [sourceSort.hashValue]) {
            let sources = c.figures.sourceBreakdown
            // Share is of the source-attributed revenue, so the column adds up to 100%.
            let total = sources.reduce(0.0) { (sum: Double, s: AnaSourceRow) -> Double in sum + s.revenue }
            return sources
                .map { (s: AnaSourceRow) -> MacReportsSourceRow in
                    MacReportsSourceRow(id: s.key, label: s.label, sales: s.orderCount, share: total > 0 ? s.revenue / total : 0,
                                        average: s.avgOrderValue, revenue: s.revenue)
                }
                .sorted(using: sourceSort)
        }
    }

    private var sources: some View {
        let rows = sourceRows
        return VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Acquisition source insights", detail: "A sale\u{2019}s source comes from the sale, then the customer")
            if rows.isEmpty {
                Text("No acquisition-source data available for the selected period.")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                Spacer(minLength: 0)
            } else {
                // The chart beside its table from about 760 points; narrower, the chart above it and the panel scrolls.
                MacReportsWidth(760) {
                    HStack(alignment: .top, spacing: 0) {
                        AnaSourceTrendChart(points: c.figures.sourceTrend)
                            .padding(.horizontal, 16)
                            .frame(minWidth: 260, maxWidth: .infinity)
                        Divider()
                        sourceTable(rows)
                    }
                } narrow: {
                    ScrollView {
                        VStack(spacing: 0) {
                            AnaSourceTrendChart(points: c.figures.sourceTrend)
                                .padding(.horizontal, 16)
                            Divider()
                            sourceTable(rows)
                                .macReportsTable(rows: rows.count)
                        }
                    }
                }
            }
        }
    }

    private func sourceTable(_ rows: [MacReportsSourceRow]) -> some View {
        Table(rows, sortOrder: $sourceSort) {
            TableColumn("Source", value: \.label) { (r: MacReportsSourceRow) in Text(r.label).lineLimit(1) }
                .width(min: 90, ideal: 130)
            TableColumn("Sales", value: \.sales) { (r: MacReportsSourceRow) in MacReportsNumber(String(r.sales)) }
                .width(min: 40, ideal: 54)
            TableColumn("Share", value: \.share) { (r: MacReportsSourceRow) in
                MacReportsNumber(AnaFormat.fixed(r.share * 100, 1) + "%")
            }
            .width(min: 50, ideal: 60)
            TableColumn("Average", value: \.average) { (r: MacReportsSourceRow) in MacAmount(r.average) }
                .width(min: 70, ideal: 90)
            TableColumn("Revenue", value: \.revenue) { (r: MacReportsSourceRow) in MacAmount(r.revenue) }
                .width(min: 70, ideal: 90)
        }
        .scrollContentBackground(.hidden)
    }
}

struct MacReportsCustomerRow: Identifiable {
    let id: String
    let customerId: String?
    let name: String
    let sales: Int
    let pieces: Double
    let average: Double
    let spent: Double
}

struct MacReportsSourceRow: Identifiable {
    let id: String
    let label: String
    let sales: Int
    let share: Double
    let average: Double
    let revenue: Double
}

// MARK: - Categories

struct MacReportsCategories: View {
    let c: MacReportsContext

    @State private var selection = Set<String>()
    @State private var sort = [KeyPathComparator(\MacReportsCategoryRow.revenue, order: .reverse)]
    @State private var base = Memo<[AnaBreakdown.CategoryRow]>()
    @State private var before = Memo<[AnaBreakdown.CategoryRow]>()
    @State private var tableMade = Memo<[MacReportsCategoryRow]>()

    private var allRows: [AnaBreakdown.CategoryRow] {
        base(c.key) { AnaBreakdown.categories(c.books, range: c.range) }
    }

    private var earlierRows: [AnaBreakdown.CategoryRow]? {
        guard let other = c.previousRange else { return nil }
        return before(c.previousKey) { AnaBreakdown.categories(c.books, range: other) }
    }

    var body: some View {
        let all = allRows
        let rows = tableRows(all)
        // A page that scrolls, like Overview and Sales: the table is as tall as its rows (a table of its own height left an
        // empty band between its last row and the note under it), and the chart's card is as tall as the table's.
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                macReportsFigures(figureList(all))
                if all.isEmpty {
                    ContentUnavailableView("No Category Sales", systemImage: "square.grid.2x2",
                                           description: Text("No category sales data for the selected period."))
                        .frame(maxWidth: .infinity, minHeight: 320)
                } else {
                    // The share chart beside the table from about 760 points; narrower, the chart above it.
                    MacReportsWidth(760) {
                        HStack(alignment: .top, spacing: 16) {
                            shareCard(all).frame(minWidth: 280, maxWidth: .infinity, maxHeight: .infinity)
                            tableCard(rows).frame(minWidth: 400, maxWidth: .infinity, maxHeight: .infinity)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    } narrow: {
                        VStack(alignment: .leading, spacing: 16) {
                            shareCard(all)
                            tableCard(rows)
                        }
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 1400, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.ground)
        .macSummaryBar(summary(rows))
    }

    private func shareCard(_ all: [AnaBreakdown.CategoryRow]) -> some View {
        MacReportsCard {
            MacReportsHeader(title: "Share of revenue", detail: nil)
            AnaShareChart(rows: all).padding(.horizontal, 16).padding(.bottom, 14)
        }
    }

    private func tableCard(_ rows: [MacReportsCategoryRow]) -> some View {
        MacReportsCard {
            MacReportsHeader(title: "By category", detail: nil)
            table(rows)
                .scrollDisabled(true)
                .macReportsTable(rows: rows.count)
            MacReportsNote(text: "Revenue is before invoice discounts and trade-ins, so it can be higher than Overview.")
        }
    }

    private func tableRows(_ all: [AnaBreakdown.CategoryRow]) -> [MacReportsCategoryRow] {
        tableMade(c.key + [sort.hashValue]) {
            let total = all.reduce(0.0) { (sum: Double, r: AnaBreakdown.CategoryRow) -> Double in sum + r.revenue }
            return all
                .map { (r: AnaBreakdown.CategoryRow) -> MacReportsCategoryRow in
                    MacReportsCategoryRow(id: r.id, name: r.name, pieces: r.itemsSold, sales: r.orders, share: total > 0 ? r.revenue / total : 0,
                                          revenue: r.revenue)
                }
                .sorted(using: sort)
        }
    }

    private static func revenue(_ rows: [AnaBreakdown.CategoryRow]) -> Double {
        rows.reduce(0.0) { (sum: Double, r: AnaBreakdown.CategoryRow) -> Double in sum + r.revenue }
    }

    private static func pieces(_ rows: [AnaBreakdown.CategoryRow]) -> Double {
        rows.reduce(0.0) { (sum: Double, r: AnaBreakdown.CategoryRow) -> Double in sum + r.itemsSold }
    }

    private func figureList(_ all: [AnaBreakdown.CategoryRow]) -> [MacFigure] {
        let earlier = earlierRows
        let revenue = Self.revenue(all)
        let pieces = Self.pieces(all)
        let wasRevenue: Double? = earlier.map { Self.revenue($0) }
        let wasPieces: Double? = earlier.map { Self.pieces($0) }
        let wasCount: Double? = earlier.map { Double($0.count) }
        var out: [MacFigure] = []
        out.append(MacReportsChange.figure("Revenue", Money.pkrLac(revenue), now: revenue, before: wasRevenue, words: c.words))
        out.append(MacReportsChange.figure("Pieces sold", AnaFormat.count(pieces), now: pieces, before: wasPieces, words: c.words))
        out.append(MacReportsChange.figure("Categories", String(all.count), now: Double(all.count), before: wasCount, words: c.words))
        return out
    }

    private func summary(_ rows: [MacReportsCategoryRow]) -> [String] {
        let picked = rows.filter { selection.contains($0.id) }
        let shownRows = picked.isEmpty ? rows : picked
        let revenue = shownRows.reduce(0.0) { (sum: Double, r: MacReportsCategoryRow) -> Double in sum + r.revenue }
        let head = picked.isEmpty ? "\(rows.count) categories" : "\(picked.count) selected"
        return [head, Money.pkrLac(revenue)]
    }

    private func table(_ rows: [MacReportsCategoryRow]) -> some View {
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Category", value: \.name) { (r: MacReportsCategoryRow) in Text(r.name).lineLimit(1) }
                .width(min: 120, ideal: 200)
            TableColumn("Pieces", value: \.pieces) { (r: MacReportsCategoryRow) in MacReportsNumber(AnaFormat.count(r.pieces)) }
                .width(min: 48, ideal: 60)
            TableColumn("Sales", value: \.sales) { (r: MacReportsCategoryRow) in MacReportsNumber(String(r.sales)) }
                .width(min: 40, ideal: 56)
            TableColumn("Share", value: \.share) { (r: MacReportsCategoryRow) in
                MacReportsNumber(AnaFormat.fixed(r.share * 100, 1) + "%")
            }
            .width(min: 50, ideal: 60)
            TableColumn("Revenue", value: \.revenue) { (r: MacReportsCategoryRow) in MacAmount(r.revenue) }
                .width(min: 70, ideal: 90)
        }
        .scrollContentBackground(.hidden)
    }
}

struct MacReportsCategoryRow: Identifiable {
    let id: String
    let name: String
    let pieces: Double
    let sales: Int
    let share: Double
    let revenue: Double
}
#endif
