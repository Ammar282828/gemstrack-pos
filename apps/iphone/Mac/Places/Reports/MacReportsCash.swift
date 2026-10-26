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
    @State private var cameMade = Memo<[MacReportsCameInRow]>()
    @State private var methodMade = Memo<[MacReportsMethodRow]>()
    @State private var outMade = Memo<[MacReportsPaidOutRow]>()
    @Environment(\.openPlaceWindow) private var openPlace

    private var isToday: Bool { picked == nil }

    /// Noon on the day shown: Karachi has no daylight saving, so noon is that day wherever the Mac is.
    private var instant: Date {
        guard let picked else { return now }
        return AnaDate.startOfDay(picked).addingTimeInterval(12 * 3600)
    }

    /// What the day's figures and rows were worked out from: a change of any makes them again (today's follow the minute).
    private var baseKey: [Int] {
        [book.invoices.revision, book.orders.revision, book.repairs.revision, book.revenue.revision,
         book.expenses.revision, AnaDate.dayKey(instant).hashValue, picked == nil ? Int(now.timeIntervalSince1970 / 60) : 0]
    }

    private var result: TodaysCash {
        guard picked != nil else { return today }
        return made(baseKey) {
            todaysCash(invoices: book.invoices.items, orders: book.orders.items, repairs: book.repairs.items,
                       extraRevenues: book.revenue.items, expenses: book.expenses.items, now: instant)
        }
    }

    var body: some View {
        let t = result
        let key = baseKey
        let came = cameInRows(t, key: key)
        let methods = methodRows(t, key: key)
        let out = paidOutRows(t, key: key)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200, maximum: 400), spacing: 16)], spacing: 16) {
                    MacDashFigureCard(title: "In the drawer", symbol: "banknote", tint: t.netCash < 0 ? Tone.owed.color : Theme.accent,
                                      value: Money.pkr(t.netCash), detail: "Cash in, less paid out",
                                      detailTone: t.netCash < 0 ? Tone.owed : nil, open: nil) { EmptyView() }
                    MacDashFigureCard(title: "Money in", symbol: "arrow.down.circle", tint: Tone.settled.color,
                                      value: Money.pkr(t.totalIn), detail: "\(came.count) line\(came.count == 1 ? "" : "s")",
                                      open: nil) { EmptyView() }
                    let n = t.expenseLines.count
                    MacDashFigureCard(title: "Paid out", symbol: "arrow.up.circle", tint: Color.orange,
                                      value: Money.pkr(t.expenses), detail: "\(n) expense\(n == 1 ? "" : "s")",
                                      open: nil) { EmptyView() }
                    MacDashFigureCard(title: "Exchange", symbol: "arrow.left.arrow.right", tint: Color.indigo,
                                      value: Money.pkr(t.exchange), detail: "In exchange, not cash",
                                      open: nil) { EmptyView() }
                }
                MacReportsWidth(880) {
                    HStack(alignment: .top, spacing: 16) {
                        cameIn(came).frame(maxWidth: .infinity)
                        VStack(spacing: 16) { methodsCard(methods); paidOutCard(out) }
                            .frame(minWidth: 320, idealWidth: 380, maxWidth: 460)
                    }
                } narrow: {
                    VStack(spacing: 16) { cameIn(came); methodsCard(methods); paidOutCard(out) }
                }
            }
            .padding(24)
            .frame(maxWidth: 1400, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.ground)
        .navigationSubtitle(DashDate.longDay(instant))
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
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

    /// Calendar's toolbar: the day before, Today, the day after as one joined control, and the day itself as a date field.
    @ViewBuilder
    private var dayControls: some View {
        ControlGroup {
            Button { step(-1) } label: { Label("Previous Day", systemImage: "chevron.left") }
                .help("The day before")
            Button("Today") { picked = nil }
                .disabled(isToday)
                .help("Back to today")
            Button { step(1) } label: { Label("Next Day", systemImage: "chevron.right") }
                .disabled(isToday)
                .help("The day after")
        }
        DatePicker("Day", selection: dayBinding, in: ...now, displayedComponents: .date)
            .datePickerStyle(.field)
            .labelsHidden()
            .environment(\.calendar, AnaDate.karachi)
            .environment(\.timeZone, ERPDate.karachi)
            .help("Any day's cash")
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

    /// The lines as rows, sorted. Two alike lines (the same ref, minute and sum) are told apart by their order among their twins.
    private func cameInRows(_ t: TodaysCash, key: [Int]) -> [MacReportsCameInRow] {
        cameMade(key) {
            var seen: [String: Int] = [:]
            var rows: [MacReportsCameInRow] = []
            for l in t.lines {
                let base = "\(l.ref)|\(l.at)|\(l.method.rawValue)|\(l.amount)"
                let n = seen[base, default: 0]
                seen[base] = n + 1
                rows.append(MacReportsCameInRow(id: "\(base)|\(n)", at: l.at, time: DashDate.clock(iso: l.at), ref: l.ref, who: l.who,
                                                source: sourceWord(l.source), method: l.method.rawValue, amount: l.amount, path: path(for: l)))
            }
            return rows.sorted { $0.at < $1.at }
        }
    }

    private func cameIn(_ rows: [MacReportsCameInRow]) -> some View {
        MacDashCard(title: "Came in", count: rows.count) {
            if rows.isEmpty {
                MacDashEmpty(symbol: "banknote", text: isToday ? "Nothing yet today. \u{2318}N starts a sale." : "No payment was taken on this day.")
            } else {
                MacDashRows(items: rows, pick: { (r: MacReportsCameInRow) in openPlace?(Route(path: r.path)) }) { (r: MacReportsCameInRow) in
                    HStack(spacing: 12) {
                        Monogram(name: r.source == "Extra revenue" ? "" : r.who, size: Monogram.Size.row)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.source == "Extra revenue" || r.who.isEmpty ? r.ref : "\(r.ref) \u{00B7} \(r.who)")
                                .font(.body).lineLimit(1)
                            Text("\(r.source) \u{00B7} \(r.method) \u{00B7} \(r.time)")
                                .font(.callout).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        RowAmount(amount: r.amount)
                    }
                }
            }
        }
    }

    // MARK: By how it was paid

    private func methodRows(_ t: TodaysCash, key: [Int]) -> [MacReportsMethodRow] {
        methodMade(key) {
            // A method nothing came in by is not a row of zeros.
            METHODS.filter { (t.byMethod[$0] ?? 0) != 0 }
                .map { MacReportsMethodRow(id: $0.rawValue, method: $0.rawValue, amount: t.byMethod[$0] ?? 0) }
                .sorted { $0.amount > $1.amount }
        }
    }

    private func methodsCard(_ rows: [MacReportsMethodRow]) -> some View {
        MacDashCard(title: "By how it was paid") {
            if rows.isEmpty {
                Text("Nothing paid in.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { (i: Int, r: MacReportsMethodRow) in
                        if i > 0 { Divider() }
                        HStack {
                            Text(r.method).font(.body)
                            Spacer(minLength: 8)
                            RowAmount(amount: r.amount)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
        }
    }

    // MARK: Paid out

    private func paidOutRows(_ t: TodaysCash, key: [Int]) -> [MacReportsPaidOutRow] {
        outMade(key) {
            var seen: [String: Int] = [:]
            var rows: [MacReportsPaidOutRow] = []
            for e in t.expenseLines {
                let base = "\(e.description)|\(e.category)|\(e.amount)"
                let n = seen[base, default: 0]
                seen[base] = n + 1
                rows.append(MacReportsPaidOutRow(id: "\(base)|\(n)", what: e.description, category: e.category, amount: e.amount))
            }
            return rows.sorted { $0.amount > $1.amount }
        }
    }

    private func paidOutCard(_ rows: [MacReportsPaidOutRow]) -> some View {
        MacDashCard(title: "Paid out", count: rows.count) {
            if rows.isEmpty {
                Text("Nothing paid out.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { (i: Int, r: MacReportsPaidOutRow) in
                        if i > 0 { Divider() }
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.what).font(.body).lineLimit(1)
                                Text(r.category).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            RowAmount(amount: r.amount)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
            Text("Expenses carry no method, so every one the business paid counts as leaving the drawer; one a partner paid out of pocket does not.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
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
