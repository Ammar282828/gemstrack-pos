#if os(macOS)
import SwiftUI
import Charts
import ERPCore

// The Mac's Today (owner, 2026-10-26: "give me a nice beautiful dashboard, cards etc"): a greeting over the day, four
// figure cards that each open their place (today's takings with the week's bars, what is owed, the month against last,
// the bench and the promises), the month's takings as a chart beside Needs you, then Due to customers and Recent sales.
// Every card is a button to its place. Nothing here works out a figure: `DashFigures` (DashboardFigures.swift) is the
// iPhone's own and Dashboard hands it in.

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
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                greeting
                let note = TeamNoteEditor.current(book)
                if !note.isEmpty {
                    MacDashNote(text: note, isOwner: isOwner, edit: editNote)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220, maximum: 400), spacing: 16)], spacing: 16) {
                    takenCard
                    owedCard
                    monthCard
                    benchCard
                }
                MacReportsWidth(900) {
                    HStack(alignment: .top, spacing: 16) {
                        chartCard.frame(maxWidth: .infinity)
                        needsCard.frame(width: 340)
                    }
                } narrow: {
                    VStack(spacing: 16) { chartCard; needsCard }
                }
                MacReportsWidth(760) {
                    HStack(alignment: .top, spacing: 16) { dueCard; salesCard }
                } narrow: {
                    VStack(spacing: 16) { dueCard; salesCard }
                }
            }
            .padding(24)
            .frame(maxWidth: 1400, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.ground)
    }

    private func go(_ path: String) { openPlace?(Route(path: path)) }

    // MARK: The greeting

    private var greeting: some View {
        let hour = Calendar.current.component(.hour, from: figures.now)
        let hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
        return VStack(alignment: .leading, spacing: 2) {
            Text(DashDate.longDay(figures.now).uppercased())
                .font(.caption.weight(.semibold)).foregroundStyle(.secondary).tracking(0.6)
            Text(hello).font(.system(size: 28, weight: .bold, design: .rounded))
        }
    }

    // MARK: The four figure cards

    private var takenCard: some View {
        let f = figures
        let n = f.todayInvoiceCount
        var detail = n == 0 ? "No invoices yet today" : "\(n) invoice\(n == 1 ? "" : "s")"
        if let last = f.lastSaleToday {
            let clock = DashDate.clock(iso: last.createdAt)
            if !clock.isEmpty { detail += " · last \(clock)" }
        }
        return MacDashFigureCard(title: "Taken today", symbol: "banknote", tint: Theme.accent,
                                 value: Money.pkrLac(f.todayRevenue), detail: detail, open: { go("/invoices") }) {
            if f.week.contains(where: { $0.amount > 0 }) {
                MacReportsSparkline(days: f.week)
            }
        }
    }

    private var owedCard: some View {
        let f = figures
        let owing = f.totalOutstanding >= 1
        var detail = "\(f.unpaid.count) unpaid invoice\(f.unpaid.count == 1 ? "" : "s")"
        if f.owedInHisaab > 0 { detail += " · \(Money.lacCrore(f.owedInHisaab)) in hisaab" }
        let path = isOwner && f.owedInHisaab > 0 ? "/hisaab" : "/invoices?list=unpaid"
        return MacDashFigureCard(title: "Owed to you", symbol: "hourglass", tint: owing ? Tone.owed.color : Tone.settled.color,
                                 value: owing ? Money.pkrLac(f.totalOutstanding) : "Nil", detail: detail,
                                 open: { go(path) }) { EmptyView() }
    }

    private var monthCard: some View {
        let f = figures
        let last = DashDate.lastMonth(f.now)
        let ratio = f.monthAgainstLast
        var detail = "Takings in \(DashDate.monthName(f.now))"
        var tone: Tone?
        if let ratio {
            if ratio > 1 {
                detail = "+\(max(1, Int(((ratio - 1) * 100).rounded())))% on \(DashDate.monthName(last))"
                tone = .settled
            } else {
                detail = "\(Int((ratio * 100).rounded()))% of \(DashDate.shortMonth(last))'s takings"
            }
        }
        var opens: (() -> Void)?
        if isOwner { opens = { go("/analytics") } }
        return MacDashFigureCard(title: "This month", symbol: "calendar", tint: Color.indigo,
                                 value: Money.pkrLac(f.revenueMonth), detail: detail, detailTone: tone,
                                 open: opens) {
            if let ratio {
                MacDashProgress(fraction: min(ratio, 1), tint: ratio >= 1 ? Tone.settled.color : Color.indigo)
            }
        }
    }

    private var benchCard: some View {
        let f = figures
        let critical = f.criticalJobs.count
        let late = f.due.filter { $0.isLate }.count
        var parts: [String] = ["\(f.due.count) promised"]
        if late > 0 { parts.append("\(late) late") }
        if critical > 0 { parts.append("\(critical) sitting \(DashBench.criticalDays)+ days") }
        return MacDashFigureCard(title: "On the bench", symbol: "hammer", tint: Color.orange,
                                 value: "\(f.activeJobs) piece\(f.activeJobs == 1 ? "" : "s")",
                                 detail: parts.joined(separator: " · "),
                                 detailTone: late > 0 || critical > 0 ? Tone.late : nil,
                                 open: { go("/workshop") }) { EmptyView() }
    }

    // MARK: The month's chart

    private var chartCard: some View {
        var opens: (() -> Void)?
        if isOwner { opens = { go("/analytics") } }
        return MacDashCard(title: "Takings this month", trailing: Money.pkrLac(figures.revenueMonth), open: opens) {
            if figures.monthDays.contains(where: { $0.amount > 0 }) {
                MacDashMonthChart(days: figures.monthDays).frame(height: 190)
            } else {
                Text("No takings yet this month.").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 190)
            }
        }
    }

    // MARK: The lists

    private var needsCard: some View {
        MacDashCard(title: "Needs you", count: needs.count) {
            if needs.isEmpty {
                MacDashEmpty(symbol: "checkmark.seal", text: "All clear. Nothing late, unpaid or waiting.")
            } else {
                MacDashRows(items: Array(needs.prefix(7))) { (n: DashNeed) in
                    if n.opensRates { setRate() } else { go(n.path) }
                } row: { (n: DashNeed) in MacReportsNeedRow(need: n) }
            }
        }
    }

    private var dueCard: some View {
        var more: (() -> Void)?
        if figures.due.count > 6 { more = { go("/orders") } }
        return MacDashCard(title: "Due to customers", count: figures.due.count, more: more) {
            if figures.due.isEmpty {
                MacDashEmpty(symbol: "shippingbox", text: "No open orders or repairs.")
            } else {
                MacDashRows(items: Array(figures.due.prefix(6))) { (d: DashDue) in go(d.path) } row: { (d: DashDue) in
                    MacReportsDueRow(due: d)
                }
            }
        }
    }

    private var salesCard: some View {
        MacDashCard(title: "Recent sales", more: { go("/invoices") }) {
            if figures.recentInvoices.isEmpty {
                MacDashEmpty(symbol: "doc.text", text: "No sales yet.")
            } else {
                MacDashRows(items: Array(figures.recentInvoices.prefix(6))) { (i: Invoice) in go(DashPath.invoice(i.id)) } row: { (i: Invoice) in
                    MacReportsSaleRow(invoice: i)
                }
            }
        }
    }
}

// MARK: - The card kit

/// A card: a rounded surface on the window's ground, a hairline and a soft shadow, lifted a little under the pointer
/// when it opens something.
struct MacDashSurface: ViewModifier {
    var hovering = false

    func body(content: Content) -> some View {
        content
            .background(Theme.card, in: .rect(cornerRadius: Radius.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Color.primary.opacity(0.07), lineWidth: 0.5))
            .shadow(color: .black.opacity(hovering ? 0.14 : 0.06), radius: hovering ? 14 : 6, y: hovering ? 6 : 2)
    }
}

/// A figure card: a tinted symbol, the figure's name, the figure large, a line under it and anything below (a chart, a
/// bar). A click opens its place.
struct MacDashFigureCard<Extra: View>: View {
    let title: String
    let symbol: String
    let tint: Color
    let value: String
    let detail: String
    var detailTone: Tone?
    let open: (() -> Void)?
    @ViewBuilder let extra: () -> Extra
    @State private var hovering = false

    init(title: String, symbol: String, tint: Color, value: String, detail: String, detailTone: Tone? = nil,
         open: (() -> Void)?, @ViewBuilder extra: @escaping () -> Extra) {
        self.title = title
        self.symbol = symbol
        self.tint = tint
        self.value = value
        self.detail = detail
        self.detailTone = detailTone
        self.open = open
        self.extra = extra
    }

    var body: some View {
        Button { open?() } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: symbol)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(tint)
                        .frame(width: 28, height: 28)
                        .background(tint.opacity(0.15), in: .rect(cornerRadius: 8, style: .continuous))
                    Text(title).font(.callout.weight(.medium)).foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    if open != nil {
                        Image(systemName: "arrow.up.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                            .opacity(hovering ? 1 : 0)
                    }
                }
                Text(value)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(detail)
                    .font(.callout)
                    .foregroundStyle(detailTone?.color ?? Color.secondary)
                    .lineLimit(2, reservesSpace: true)
                // The same room under every figure, a chart or a bar or nothing, so the four cards stand level.
                extra()
                    .frame(maxWidth: .infinity, minHeight: 34, maxHeight: 34, alignment: .bottomLeading)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .contentShape(Rectangle())
            .modifier(MacDashSurface(hovering: hovering && open != nil))
        }
        .buttonStyle(.plain)
        .disabled(open == nil)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.15), value: hovering)
        .help(open == nil ? title : "Open \(title)")
    }
}

/// A card with a heading (a count beside it, "Show all" or a figure at its right) and its content.
struct MacDashCard<Content: View>: View {
    let title: String
    var count: Int?
    var trailing: String?
    var open: (() -> Void)?
    var more: (() -> Void)?
    @ViewBuilder let content: () -> Content

    init(title: String, count: Int? = nil, trailing: String? = nil, open: (() -> Void)? = nil, more: (() -> Void)? = nil,
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.count = count
        self.trailing = trailing
        self.open = open
        self.more = more
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text(title).font(.headline)
                if let count, count > 0 {
                    Text("\(count)").font(.caption.weight(.semibold)).monospacedDigit()
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(Color.primary.opacity(0.08), in: Capsule())
                }
                Spacer(minLength: 8)
                if let trailing {
                    Text(trailing).font(.headline).monospacedDigit().foregroundStyle(.secondary)
                }
                if let action = more ?? open {
                    Button(more != nil ? "Show All" : "Open", action: action)
                        .buttonStyle(.link)
                        .font(.callout)
                }
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .modifier(MacDashSurface())
    }
}

/// Rows inside a card: each a button that lights under the pointer, divided by hairlines.
struct MacDashRows<Item: Identifiable, Row: View>: View {
    let items: [Item]
    let pick: (Item) -> Void
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { i, item in
                if i > 0 { Divider().padding(.leading, 4) }
                MacDashRow { pick(item) } label: { row(item) }
            }
        }
    }
}

struct MacDashRow<Label: View>: View {
    let action: () -> Void
    @ViewBuilder let label: () -> Label
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            label()
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .background(hovering ? Color.primary.opacity(0.06) : Color.clear, in: .rect(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// A card with nothing in it: a symbol and a line.
struct MacDashEmpty: View {
    let symbol: String
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.title3).foregroundStyle(Tone.settled.color)
            Text(text).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 80)
    }
}

/// How far the month has come against the whole of last month.
struct MacDashProgress: View {
    let fraction: Double
    let tint: Color

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
                Capsule().fill(tint).frame(width: max(6, g.size.width * fraction))
            }
        }
        .frame(height: 6)
    }
}

/// The month's takings day by day: rounded bars, today's in the accent, with a light grid.
struct MacDashMonthChart: View {
    let days: [DashDay]

    var body: some View {
        let today = days.last?.id
        Chart {
            ForEach(days) { (d: DashDay) in
                BarMark(x: .value("Day", d.day, unit: .day), y: .value("Taken", d.amount))
                    .foregroundStyle(d.id == today ? Theme.accent : Theme.accent.opacity(0.45))
                    .cornerRadius(4)
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing) { (v: AxisValue) in
                AxisGridLine().foregroundStyle(Color.primary.opacity(0.06))
                AxisValueLabel { if let n = v.as(Double.self) { Text(Money.axisLac(n)) } }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .day, count: 7)) { (_: AxisValue) in
                AxisValueLabel(format: .dateTime.day().month(.abbreviated))
            }
        }
        .accessibilityLabel("Takings each day this month")
    }
}

/// The team note as a card: a pin, the words, the pencil for owners.
struct MacDashNote: View {
    let text: String
    let isOwner: Bool
    let edit: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "pin.fill").foregroundStyle(.orange)
            Text(text).lineLimit(3).textSelection(.enabled)
            Spacer(minLength: 8)
            if isOwner {
                Button(action: edit) { Image(systemName: "pencil") }
                    .buttonStyle(.borderless)
                    .help("Edit the team note")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yellow.opacity(0.18), in: .rect(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.yellow.opacity(0.35), lineWidth: 0.5))
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
