#if os(macOS)
import SwiftUI
import Charts
import ERPCore

// The Mac's Today (docs/features/mac-design.md, "Today"): one page, no cards. The team note as a plain yellow strip, five
// plain figures that each open their place, then three columns of plain lists (Needs you, Due to customers, Recent
// sales) with every row shown, selectable, opening its record in a window of its own. Nothing here works out a figure:
// `DashFigures` (DashboardFigures.swift) is the iPhone's own and Dashboard hands it in.

struct MacReportsTodayPage: View {
    let figures: DashFigures
    let needs: [DashNeed]
    let isOwner: Bool
    /// The pencil on the note: the team note's editor.
    let editNote: () -> Void
    /// A row that asks for today's rate opens the rate form.
    let setRate: () -> Void

    @Environment(Book.self) private var book
    @Environment(\.openPlaceWindow) private var openPlace

    var body: some View {
        VStack(spacing: 0) {
            MacReportsNoteStrip(text: TeamNoteEditor.current(book), isOwner: isOwner, edit: editNote)
            head
            Divider()
            // Three columns from about 780 points; narrower, the lists stand one under another and the page scrolls
            // (each column would be under 260 points, too narrow for a row's two lines).
            MacReportsWidth(780) {
                HStack(spacing: 0) {
                    needsList
                    Divider()
                    dueList
                    Divider()
                    salesList
                }
            } narrow: {
                ScrollView {
                    VStack(spacing: 0) {
                        needsList.frame(height: 260)
                        Divider()
                        dueList.frame(height: 260)
                        Divider()
                        salesList.frame(height: 260)
                    }
                }
            }
        }
    }

    // MARK: The figures

    private var head: some View {
        VStack(alignment: .leading, spacing: 0) {
            macReportsFigures(figureList)
            sparkline
        }
    }

    private func go(_ path: String) {
        openPlace?(Route(path: path))
    }

    private var figureList: [MacFigure] {
        let f = figures
        return [taken(f), owed(f), bench(f), month(f), orders(f)]
    }

    private func taken(_ f: DashFigures) -> MacFigure {
        let n = f.todayInvoiceCount
        var detail = n == 0 ? "No invoices yet today" : "\(n) invoice\(n == 1 ? "" : "s")"
        if let last = f.lastSaleToday {
            let clock = DashDate.clock(iso: last.createdAt)
            if !clock.isEmpty { detail += " · last \(clock)" }
        }
        return MacFigure("Taken today", Money.pkrLac(f.todayRevenue), detail: detail, open: { go("/invoices") })
    }

    private func owed(_ f: DashFigures) -> MacFigure {
        let owing = f.totalOutstanding >= 1
        var detail = "\(f.unpaid.count) unpaid"
        if f.owedInHisaab > 0 { detail += " · \(Money.lacCrore(f.owedInHisaab)) in hisaab" }
        // The hisaab is the owners' book.
        let path = isOwner && f.owedInHisaab > 0 ? "/hisaab" : "/invoices"
        return MacFigure("Owed to you", owing ? Money.pkrLac(f.totalOutstanding) : "Nil", detail: detail,
                         tone: owing ? Tone.owed : nil, open: { go(path) })
    }

    private func bench(_ f: DashFigures) -> MacFigure {
        let n = f.activeJobs
        let critical = f.criticalJobs.count
        // Nothing overdue is the normal state: no line for it.
        let detail: String? = critical > 0 ? "\(critical) sitting \(DashBench.criticalDays)+ days" : nil
        return MacFigure("On the bench", "\(n) piece\(n == 1 ? "" : "s")", detail: detail,
                         detailTone: critical > 0 ? Tone.late : nil, open: { go("/workshop") })
    }

    /// This month so far against last: "+12% on September" once it has passed the whole of last month, else how far along
    /// it is ("62% of Sep"), the words Home has always used.
    private func month(_ f: DashFigures) -> MacFigure {
        let last = DashDate.lastMonth(f.now)
        var detail = DashDate.monthName(f.now)
        var tone: Tone?
        if let ratio = f.monthAgainstLast {
            if ratio > 1 {
                detail = "+\(max(1, Int(((ratio - 1) * 100).rounded())))% on \(DashDate.monthName(last))"
                tone = .settled
            } else {
                detail = "\(Int((ratio * 100).rounded()))% of \(DashDate.shortMonth(last))"
            }
        }
        // Analytics is the owners'.
        var opens: (() -> Void)?
        if isOwner { opens = { go("/analytics") } }
        return MacFigure("This month", Money.pkrLac(f.revenueMonth), detail: detail, detailTone: tone, open: opens)
    }

    /// Orders and repairs promised to customers; red only for the late ones.
    private func orders(_ f: DashFigures) -> MacFigure {
        let n = f.due.count
        let late = f.due.filter { $0.isLate }.count
        return MacFigure("Orders due", n == 0 ? "None" : "\(n) open", detail: late > 0 ? "\(late) late" : nil,
                         detailTone: late > 0 ? Tone.late : nil, open: { go("/orders") })
    }

    /// The week's days as small bars under Taken today, set under the first figure's column.
    @ViewBuilder
    private var sparkline: some View {
        if figures.week.contains(where: { $0.amount > 0 }) {
            HStack(spacing: 0) {
                MacReportsSparkline(days: figures.week)
                    .frame(width: 120, height: 24)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)
        }
    }

    // MARK: The three lists

    private var needsList: some View {
        MacReportsTodayList(title: "Needs you", count: needs.count, items: needs,
                            emptyText: "All clear. Nothing late, unpaid or waiting.",
                            path: { (n: DashNeed) -> String? in n.opensRates ? nil : n.path },
                            special: (title: "Set Today’s Rate…", run: setRate)) { (n: DashNeed) in
            MacReportsNeedRow(need: n)
        }
    }

    private var dueList: some View {
        MacReportsTodayList(title: "Due to customers", count: figures.due.count, items: figures.due,
                            emptyText: "No open orders or repairs.",
                            path: { (d: DashDue) -> String? in d.path },
                            special: nil) { (d: DashDue) in
            MacReportsDueRow(due: d)
        }
    }

    private var salesList: some View {
        MacReportsTodayList(title: "Recent sales", count: nil, items: figures.recentInvoices,
                            emptyText: "No sales yet.",
                            path: { (i: Invoice) -> String? in DashPath.invoice(i.id) },
                            special: nil) { (i: Invoice) in
            MacReportsSaleRow(invoice: i)
        }
    }
}

// MARK: - The team note

/// The team note as a plain yellow strip; the pencil is the owners'.
struct MacReportsNoteStrip: View {
    let text: String
    let isOwner: Bool
    let edit: () -> Void

    var body: some View {
        if !text.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "pin.fill").foregroundStyle(.orange)
                Text(text).lineLimit(3).textSelection(.enabled)
                Spacer(minLength: 8)
                if isOwner {
                    Button(action: edit) { Image(systemName: "pencil") }
                        .buttonStyle(.borderless)
                        .help("Edit the team note")
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.yellow.opacity(0.22))
            .overlay(alignment: .bottom) { Divider() }
        }
    }
}

// MARK: - The week's bars

/// Seven days as bars, no axes: today's in the accent, the six before it faint.
struct MacReportsSparkline: View {
    let days: [DashDay]

    var body: some View {
        let today = days.last?.id
        Chart {
            ForEach(days) { (d: DashDay) in
                BarMark(x: .value("Day", DashDate.weekdayDayMonth(d.day)), y: .value("Taken", d.amount))
                    .foregroundStyle(d.id == today ? Theme.accent : Theme.accent.opacity(0.28))
                    .cornerRadius(2)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .help("Taken each day over the last 7 days")
        .accessibilityLabel("Taken each day over the last 7 days")
        .accessibilityValue(ChartSummary.say(days.map { (label: DashDate.weekdayDayMonth($0.day), value: $0.amount) }))
    }
}

// MARK: - A list

/// One of Today's lists: a plain `List` with its section header, every row shown, selectable. Return or a double-click
/// opens the picked record in a window of its own; the right-click menu has Open and Open in New Window.
struct MacReportsTodayList<Item: Identifiable, Row: View>: View where Item.ID == String {
    let title: String
    let count: Int?
    let items: [Item]
    let emptyText: String
    /// Where an item opens; nil is a row that opens something else (`special`).
    let path: (Item) -> String?
    /// What a row with no place does (the rate form), and the menu's words for it.
    let special: (title: String, run: () -> Void)?
    @ViewBuilder let row: (Item) -> Row

    @Environment(\.openPlaceWindow) private var openPlace
    @State private var picked = Set<String>()

    var body: some View {
        List(selection: $picked) {
            Section {
                if items.isEmpty {
                    Text(emptyText).foregroundStyle(.secondary)
                } else {
                    ForEach(items) { (item: Item) in
                        row(item).tag(item.id)
                    }
                }
            } header: {
                header
            }
        }
        .listStyle(.inset)
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            menu(ids)
        } primaryAction: { (ids: Set<String>) in
            open(ids)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text(title)
            if let count, count > 0 { Text("\(count)").foregroundStyle(.secondary).monospacedDigit() }
        }
    }

    @ViewBuilder
    private func menu(_ ids: Set<String>) -> some View {
        if let item = items.first(where: { ids.contains($0.id) }) {
            if let place = path(item) {
                NavigationLink(value: Route(path: place)) { Text("Open") }
                if let openPlace {
                    Button("Open in New Window") { openPlace(Route(path: place)) }
                }
            } else if let special {
                Button(special.title) { special.run() }
            }
        }
    }

    private func open(_ ids: Set<String>) {
        for item in items.filter({ ids.contains($0.id) }).prefix(5) {
            if let place = path(item) {
                openPlace?(Route(path: place))
            } else {
                special?.run()
            }
        }
    }
}

// MARK: - The rows

/// One thing waiting on a decision: what it is about (a symbol in its tone), what to know, what it comes to.
struct MacReportsNeedRow: View {
    let need: DashNeed

    /// Red for what is late, amber for what is owed or soon, quiet for a date worth knowing.
    private var tone: Tone {
        switch need.tone {
        case .danger: return .late
        case .warn: return .owed
        case .plain: return .quiet
        }
    }

    private var symbol: String {
        switch need.kind {
        case .rate: return "chart.line.uptrend.xyaxis"
        case .online: return "globe"
        case .late: return "clock.badge.exclamationmark"
        case .bench: return "hammer"
        case .unassigned: return "person.crop.circle.badge.questionmark"
        case .unpaid: return "banknote"
        case .repairReady: return "wrench.and.screwdriver"
        case .birthday: return "gift"
        case .anniversary: return "heart"
        case .other: return "exclamationmark.circle"
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .foregroundStyle(tone.color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(need.title).lineLimit(2)
                Text(need.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 8)
            if let amount = need.amount {
                Text(Money.pkrLac(amount)).monospacedDigit().foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// A promise to a customer, an order or a repair: who, which, the promised day, and how it stands.
struct MacReportsDueRow: View {
    let due: DashDue

    var body: some View {
        let words = PromiseWords.say(due.timing)
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(due.customer).lineLimit(1)
                Text(due.refLine).font(.caption).foregroundStyle(.secondary).monospacedDigit().lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                MacStatus(words.text, tone: words.tone)
                if due.amount > 0 {
                    Text(Money.pkr(due.amount)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// A recent sale: who, when, what it was worth, and whether it is paid.
struct MacReportsSaleRow: View {
    let invoice: Invoice

    /// What is still due, the customer's credit, or a refund; nil when paid (the normal state carries no word).
    private var standing: (text: String, tone: Tone)? {
        if invoice.status == .refunded { return ("Refunded", .quiet) }
        let b = balanceLine(invoice.balanceDue)
        switch b.state {
        case .paid: return nil
        case .due: return ("\(Money.pkrLac(b.amount)) due", .owed)
        case .credit: return ("In credit", .credit)
        }
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(DashText.name(invoice.customerName)).lineLimit(1)
                Text(ShopDate.say(invoice.createdAt, withTime: true)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text(Money.pkrLac(invoiceSaleValue(invoice))).monospacedDigit()
                if let standing {
                    MacStatus(standing.text, tone: standing.tone).font(.caption)
                }
            }
        }
        .padding(.vertical, 2)
    }
}
#endif
