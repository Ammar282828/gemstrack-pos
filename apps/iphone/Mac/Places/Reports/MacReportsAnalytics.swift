#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's Analytics (docs/features/mac-design.md, "Analytics"): a report per section. The period and the comparison are
// the toolbar's pop-ups, the figures are one plain row with their change, the charts read out on hover, and every list is a
// sortable table. The sidebar lists the sections, so nothing here switches between them. Every figure is the iPhone's:
// `AnaFigures` and `AnaBreakdown` (AnalyticsFigures.swift), worked out by AnalyticsScreen; a comparison is the same
// `AnaFigures` over another range.

/// What every section of the report reads.
struct MacReportsContext {
    let books: AnaBooks
    let figures: AnaFigures
    let range: AnaRange?
    /// The range compared with, and the figures over it; nil while nothing is compared.
    let previousRange: AnaRange?
    let previous: AnaFigures?
    /// What a change is "on": "previous period", "last year".
    let words: String
    let margin: MarginSettings?
    /// The shelves' revisions: what a section's Memo is keyed on, with the period.
    let booksKey: [Int]

    var showCosts: Bool { margin != nil }
    var comparing: Bool { previousRange != nil }

    var key: [Int] { booksKey + [Self.stamp(range?.from), Self.stamp(range?.to)] }
    var previousKey: [Int] { booksKey + [Self.stamp(previousRange?.from), Self.stamp(previousRange?.to), 7] }

    static func stamp(_ d: Date?) -> Int { d.map { Int($0.timeIntervalSince1970) } ?? -1 }
}

struct MacReportsAnalyticsPage: View {
    let section: AnaSection
    let books: AnaBooks
    let figures: AnaFigures
    let period: AnaPeriodState
    let margin: MarginSettings?
    let empty: AnaEmptyKind?
    @Binding var rangeKey: String
    @Binding var customFrom: String
    @Binding var customTo: String

    @Environment(Book.self) private var book
    @AppStorage("mac.analytics.compare") private var compareKey = MacReportsCompare.previous.rawValue
    @State private var customSheet = false
    @State private var pdf: MacReportsMonth?
    @State private var comparedFigures = Memo<AnaFigures>()

    var body: some View {
        Group {
            if let kind = empty {
                emptyState(kind)
            } else {
                sectionView(context)
            }
        }
        .navigationSubtitle(AnaPeriod.describe(period.range))
        .toolbar {
            // One menu for the period and what it is compared with (inline pickers inside it), then the monthly PDF.
            ToolbarItemGroup(placement: .automatic) {
                periodMenu
                if section == .overview && margin != nil { monthlyMenu }
            }
        }
        .sheet(isPresented: $customSheet) { customPeriod }
        .sheet(item: $pdf) { (m: MacReportsMonth) in monthSheet(m) }
    }

    // MARK: What the sections read

    private var mode: MacReportsCompare {
        guard period.range != nil else { return .none }
        return MacReportsCompare(rawValue: compareKey) ?? .previous
    }

    private var context: MacReportsContext {
        let revisions = [book.invoices.revision, book.orders.revision, book.products.revision, book.customers.revision,
                         book.expenses.revision, book.revenue.revision, book.settings.revision]
        let other = MacReportsPeriods.compared(period.range, mode: mode)
        var before: AnaFigures?
        if let other {
            let key = revisions + [MacReportsContext.stamp(other.from), MacReportsContext.stamp(other.to)]
            before = comparedFigures(key) { AnaFigures(books, range: other, margin: margin) }
        }
        return MacReportsContext(books: books, figures: figures, range: period.range, previousRange: other, previous: before,
                                 words: mode.words, margin: margin, booksKey: revisions)
    }

    @ViewBuilder
    private func sectionView(_ c: MacReportsContext) -> some View {
        switch section {
        case .overview: MacReportsOverview(c: c)
        case .sales: MacReportsSales(c: c, pickYear: { (year: Int) in rangeKey = "year-\(year)" })
        case .products: MacReportsProducts(c: c)
        case .customers: MacReportsCustomers(c: c)
        case .categories: MacReportsCategories(c: c)
        }
    }

    @ViewBuilder
    private func emptyState(_ kind: AnaEmptyKind) -> some View {
        Group {
            switch kind {
            case .nothingInRange:
                NotAvailableState("Nothing in this range", why: "There are no invoices or orders in the selected period. Pick another period from the toolbar.",
                                  symbol: "chart.bar")
            case .noData:
                NotAvailableState("No data yet", why: "There is no data available to generate analytics yet.", symbol: "chart.bar")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: The period

    /// The pop-up's choice: a custom period that is exactly last month or this quarter reads as that.
    private var choice: String {
        if period.key == "custom", let r = period.range {
            let now = Date()
            if MacReportsPeriods.same(r, MacReportsPeriods.lastMonth(now)) { return "last-month" }
            if MacReportsPeriods.same(r, MacReportsPeriods.thisQuarter(now)) { return "this-quarter" }
        }
        return period.key
    }

    private var choiceBinding: Binding<String> {
        Binding<String>(get: { choice }, set: { (key: String) in apply(key) })
    }

    private func apply(_ key: String) {
        switch key {
        case "last-month": setCustom(MacReportsPeriods.lastMonth(Date()))
        case "this-quarter": setCustom(MacReportsPeriods.thisQuarter(Date()))
        default: rangeKey = key
        }
    }

    /// The custom period, its days written where every Analytics place reads them.
    private func setCustom(_ r: AnaRange) {
        customFrom = AnaDate.dayKey(r.from)
        customTo = AnaDate.dayKey(r.to)
        rangeKey = "custom"
    }

    private var customLabel: String {
        guard let r = period.range else { return "Custom" }
        let a = AnaDate.dayMonth(r.from)
        let b = AnaDate.dayMonth(r.to)
        return a == b ? a : "\(a) to \(b)"
    }

    private var periodLabel: String {
        if let year = AnaPeriod.year(period.key) { return String(year) }
        if let c = MacReportsPeriods.choices.first(where: { $0.key == choice }) { return c.label }
        return customLabel
    }

    @ViewBuilder
    private var extraChoice: some View {
        if let year = AnaPeriod.year(period.key) {
            Text(String(year)).tag(period.key)
        } else if choice == "custom" {
            Text(customLabel).tag("custom")
        }
    }

    private var periodMenu: some View {
        Menu {
            Section("Period") {
                Picker("Period", selection: choiceBinding) {
                    ForEach(MacReportsPeriods.choices) { (c: MacReportsPeriodChoice) in
                        Text(c.label).tag(c.key)
                    }
                    extraChoice
                }
                .pickerStyle(.inline)
                .labelsHidden()
                Button("Custom Period\u{2026}") { customSheet = true }
            }
            Section("Compare with") {
                Picker("Compare with", selection: compareBinding) {
                    Text(MacReportsCompare.previous.label).tag(MacReportsCompare.previous.rawValue)
                    Text(MacReportsCompare.lastYear.label).tag(MacReportsCompare.lastYear.rawValue)
                    Text(MacReportsCompare.none.label).tag(MacReportsCompare.none.rawValue)
                }
                .pickerStyle(.inline)
                .labelsHidden()
                .disabled(period.range == nil)
            }
        } label: {
            Label(periodLabel, systemImage: "calendar").labelStyle(.titleAndIcon)
        }
        .help("The period every Analytics place reads, and what its figures are compared with. " + compareHelp)
    }

    private var customPeriod: some View {
        AnaCustomPeriod(start: period.range?.from ?? AnaDate.adding(days: -29, to: Date()),
                        end: period.range?.to ?? Date()) { (a: Date, b: Date) in
            customFrom = AnaDate.dayKey(a)
            customTo = AnaDate.dayKey(b)
            rangeKey = "custom"
        }
    }

    // MARK: The comparison

    private var compareBinding: Binding<String> {
        Binding<String>(get: { mode.rawValue }, set: { (key: String) in compareKey = key })
    }

    /// What the figures are being compared with, in days.
    private var compareHelp: String {
        guard let other = MacReportsPeriods.compared(period.range, mode: mode) else {
            return "Compare the figures with the previous period or the same period last year"
        }
        return "Compared with " + AnaPeriod.describe(other)
    }

    // MARK: The monthly PDF

    private var monthlyMenu: some View {
        Menu {
            ForEach(MacReportsPeriods.months()) { (m: MacReportsMonth) in
                Button(m.label) { pdf = m }
            }
        } label: {
            Label("Monthly PDF", systemImage: "arrow.down.doc")
        }
        .help("A month's report as a PDF, drawn by the ERP: the same document the 1st's WhatsApp report carries")
    }

    /// The month's PDF in one sheet, the month already chosen from the menu: no sheet over a sheet.
    private func monthSheet(_ m: MacReportsMonth) -> some View {
        NavigationStack {
            PDFDocumentScreen(path: "/api/reports/monthly?month=" + m.key, fileName: "monthly-report-" + m.key + ".pdf", title: m.title, timeout: 150, wait: "Drawing the report: figures, trends and every sale. This takes a few seconds.")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { pdf = nil } }
                }
        }
        // A sheet's least size stays small; it opens at the size a page of the report reads at.
        .frame(minWidth: 560, idealWidth: 720, minHeight: 520, idealHeight: 760)
    }
}
#endif
