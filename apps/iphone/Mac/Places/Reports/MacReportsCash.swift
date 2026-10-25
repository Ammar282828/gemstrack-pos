#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's Today's cash (docs/features/mac-design.md, "Money"): a report. A day picker in the toolbar (any day, not only
// today), the four figures in one row, then three tables: what came in (each line opens its document), how it was paid,
// and what went out. Every figure is ERPCore's `todaysCash`, the iPhone's own; a day other than today is the same call
// with that day's instant.

struct MacReportsCashPage: View {
    /// Today's cash as the screen worked it out (the screen re-reads it each minute so it turns over at midnight).
    let today: TodaysCash
    let now: Date

    @Environment(Book.self) private var book
    /// nil is today, following the clock; any other day is the picker's.
    @State private var picked: Date?
    @State private var made = Memo<TodaysCash>()
    @State private var cameSort = [KeyPathComparator(\MacReportsCameInRow.at)]
    @State private var methodSort = [KeyPathComparator(\MacReportsMethodRow.amount, order: .reverse)]
    @State private var outSort = [KeyPathComparator(\MacReportsPaidOutRow.amount, order: .reverse)]
    @State private var cameSelection = Set<String>()

    private var isToday: Bool { picked == nil }

    /// Noon on the day shown: Karachi has no daylight saving, so noon is that day wherever the Mac is.
    private var instant: Date {
        guard let picked else { return now }
        return AnaDate.startOfDay(picked).addingTimeInterval(12 * 3600)
    }

    private var result: TodaysCash {
        guard picked != nil else { return today }
        let key = [book.invoices.revision, book.orders.revision, book.repairs.revision, book.revenue.revision,
                   book.expenses.revision, AnaDate.dayKey(instant).hashValue]
        return made(key) {
            todaysCash(invoices: book.invoices.items, orders: book.orders.items, repairs: book.repairs.items,
                       extraRevenues: book.revenue.items, expenses: book.expenses.items, now: instant)
        }
    }

    var body: some View {
        let t = result
        VStack(spacing: 0) {
            macReportsFigures(figureList(t))
            Divider()
            HStack(spacing: 0) {
                cameIn(t)
                Divider()
                VStack(spacing: 0) {
                    methods(t)
                    Divider()
                    paidOut(t)
                }
                .frame(minWidth: 320, idealWidth: 380, maxWidth: 460)
            }
        }
        .navigationSubtitle(DashDate.longDay(instant))
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                dayControls
            }
        }
    }

    // MARK: The day

    private var dayBinding: Binding<Date> {
        Binding<Date>(
            get: { picked ?? now },
            set: { (new: Date) in picked = AnaDate.karachi.isDate(new, inSameDayAs: now) ? nil : new }
        )
    }

    private func step(_ days: Int) {
        let next = AnaDate.adding(days: days, to: picked ?? now)
        picked = AnaDate.karachi.isDate(next, inSameDayAs: now) ? nil : next
    }

    @ViewBuilder
    private var dayControls: some View {
        Button { step(-1) } label: { Label("Previous Day", systemImage: "chevron.left") }
            .help("The day before")
        DatePicker("Day", selection: dayBinding, in: ...now, displayedComponents: .date)
            .datePickerStyle(.field)
            .labelsHidden()
            .environment(\.calendar, AnaDate.karachi)
            .environment(\.timeZone, ERPDate.karachi)
            .help("Any day's cash")
        Button { step(1) } label: { Label("Next Day", systemImage: "chevron.right") }
            .disabled(isToday)
            .help("The day after")
        Button("Today") { picked = nil }
            .disabled(isToday)
            .help("Back to today")
    }

    // MARK: The figures

    private func figureList(_ t: TodaysCash) -> [MacFigure] {
        let n = t.expenseLines.count
        return [
            MacFigure("In the drawer", Money.pkr(t.netCash), detail: "Cash in, less paid out", tone: t.netCash < 0 ? Tone.owed : nil),
            MacFigure("Money in", Money.pkr(t.totalIn)),
            MacFigure("Paid out", Money.pkr(t.expenses), detail: "\(n) expense\(n == 1 ? "" : "s")"),
            MacFigure("Exchange", Money.pkr(t.exchange), detail: "In exchange, not cash"),
        ]
    }

    // MARK: Came in

    private func sourceWord(_ s: CashSource) -> String {
        switch s {
        case .invoice: return "Invoice"
        case .advance: return "Order advance"
        case .repair: return "Repair"
        case .extra: return "Extra revenue"
        }
    }

    private func path(for l: CashLine) -> String {
        switch l.source {
        case .invoice: return DashPath.invoice(l.ref)
        case .advance: return DashPath.order(l.ref)
        case .repair: return DashPath.repair(l.ref)
        case .extra: return "/additional-revenue"
        }
    }

    /// The lines as rows. Two alike lines (the same ref, minute and sum) are told apart by their order among their twins.
    private func cameInRows(_ t: TodaysCash) -> [MacReportsCameInRow] {
        var seen: [String: Int] = [:]
        var rows: [MacReportsCameInRow] = []
        for l in t.lines {
            let base = "\(l.ref)|\(l.at)|\(l.method.rawValue)|\(l.amount)"
            let n = seen[base, default: 0]
            seen[base] = n + 1
            rows.append(MacReportsCameInRow(id: "\(base)|\(n)", at: l.at, time: DashDate.clock(iso: l.at), ref: l.ref, who: l.who,
                                            source: sourceWord(l.source), method: l.method.rawValue, amount: l.amount, path: path(for: l)))
        }
        return rows.sorted(using: cameSort)
    }

    private func cameIn(_ t: TodaysCash) -> some View {
        let rows = cameInRows(t)
        let paths = Dictionary(rows.map { ($0.id, $0.path) }, uniquingKeysWith: { first, _ in first })
        return VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Came in", detail: rows.isEmpty ? nil : "\(rows.count) line\(rows.count == 1 ? "" : "s")")
            Table(rows, selection: $cameSelection, sortOrder: $cameSort) {
                TableColumn("Time", value: \.at) { (r: MacReportsCameInRow) in Text(r.time).monospacedDigit() }
                    .width(min: 70, ideal: 80)
                TableColumn("Reference", value: \.ref) { (r: MacReportsCameInRow) in Text(r.ref).monospacedDigit() }
                    .width(min: 100, ideal: 140)
                TableColumn("For", value: \.who)
                TableColumn("Source", value: \.source)
                    .width(min: 90, ideal: 110)
                TableColumn("Paid by", value: \.method)
                    .width(min: 80, ideal: 100)
                TableColumn("Amount", value: \.amount) { (r: MacReportsCameInRow) in
                    Text(Money.pkr(r.amount)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 90, ideal: 110)
            }
            .macOpenSelection { (id: String) -> String? in paths[id] }
            .overlay {
                if rows.isEmpty {
                    Text(isToday ? "Nothing yet today." : "Nothing came in on this day.").foregroundStyle(.secondary)
                }
            }
        }
        .frame(minWidth: 480, maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: By how it was paid

    private func methodRows(_ t: TodaysCash) -> [MacReportsMethodRow] {
        // A method nothing came in by is not a row of zeros.
        METHODS.filter { (t.byMethod[$0] ?? 0) != 0 }
            .map { MacReportsMethodRow(id: $0.rawValue, method: $0.rawValue, amount: t.byMethod[$0] ?? 0) }
            .sorted(using: methodSort)
    }

    private func methods(_ t: TodaysCash) -> some View {
        let rows = methodRows(t)
        return VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "By how it was paid", detail: nil)
            Table(rows, sortOrder: $methodSort) {
                TableColumn("Paid by", value: \.method)
                TableColumn("Amount", value: \.amount) { (r: MacReportsMethodRow) in
                    Text(Money.pkr(r.amount)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 90, ideal: 120)
            }
            .overlay {
                if rows.isEmpty { Text("Nothing paid in.").foregroundStyle(.secondary) }
            }
        }
        .frame(height: 70 + 24 * CGFloat(max(rows.count, 1)))
    }

    // MARK: Paid out

    private func paidOutRows(_ t: TodaysCash) -> [MacReportsPaidOutRow] {
        var seen: [String: Int] = [:]
        var rows: [MacReportsPaidOutRow] = []
        for e in t.expenseLines {
            let base = "\(e.description)|\(e.category)|\(e.amount)"
            let n = seen[base, default: 0]
            seen[base] = n + 1
            rows.append(MacReportsPaidOutRow(id: "\(base)|\(n)", what: e.description, category: e.category, amount: e.amount))
        }
        return rows.sorted(using: outSort)
    }

    private func paidOut(_ t: TodaysCash) -> some View {
        let rows = paidOutRows(t)
        return VStack(alignment: .leading, spacing: 0) {
            MacReportsHeader(title: "Paid out", detail: rows.isEmpty ? nil : "\(rows.count) expense\(rows.count == 1 ? "" : "s")")
            Table(rows, sortOrder: $outSort) {
                TableColumn("What", value: \.what)
                TableColumn("Category", value: \.category)
                    .width(min: 80, ideal: 110)
                TableColumn("Amount", value: \.amount) { (r: MacReportsPaidOutRow) in
                    Text(Money.pkr(r.amount)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
                }
                .width(min: 80, ideal: 100)
            }
            .overlay {
                if rows.isEmpty { Text("Nothing paid out.").foregroundStyle(.secondary) }
            }
            Text("Expenses carry no method, so every one the business paid counts as leaving the drawer; one a partner paid out of pocket does not.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
        }
        .frame(maxHeight: .infinity)
    }
}

// MARK: - Rows

struct MacReportsCameInRow: Identifiable {
    let id: String
    /// The payment's own instant, as the books keep it: what Time sorts by.
    let at: String
    let time: String
    let ref: String
    let who: String
    let source: String
    let method: String
    let amount: Double
    /// Where the document opens.
    let path: String
}

struct MacReportsMethodRow: Identifiable {
    let id: String
    let method: String
    let amount: Double
}

struct MacReportsPaidOutRow: Identifiable {
    let id: String
    let what: String
    let category: String
    let amount: Double
}
#endif
