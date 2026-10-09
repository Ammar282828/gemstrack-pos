import SwiftUI
import Charts
import ERPCore

// The dashboard's pieces (src/app/page.tsx: Headline, Panel, TaskRow, DueRow, RecentInvoiceRow, the 30-day link),
// redrawn on the ledger (App/UI/Ledger.swift, 2026-10-09): one hero for today, three small cards under it, and
// each list a card of rows that lead with what they are about (a symbol, a promised day, a person).
// Content sits on the house's ground and cards; nothing here is glass (CONVENTIONS.md rule 4).
// There are no buttons: every card and row is a link to the place it names (an owner's "Set today's rate"
// opens the rate form instead), and New sale is the app's bar.

// MARK: Small words

/// A card's name in small capitals: "TAKEN TODAY", "OWED TO YOU".
struct DashLabel: View {
    let text: String
    var font: Font = .caption2.weight(.semibold)

    init(_ text: String, font: Font = .caption2.weight(.semibold)) {
        self.text = text
        self.font = font
    }

    var body: some View {
        Text(text)
            .font(font)
            .tracking(0.6)
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
    }
}

/// The quiet arrow on whatever opens a place.
struct DashChevron: View {
    var body: some View {
        Image(systemName: "chevron.right")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
    }
}

// MARK: Today

/// The page's one big figure: what was taken today, how many invoices, when the last sale was rung up, and the
/// week's days as bars with today's in the house's accent.
struct DashHero: View {
    let amount: Double
    let invoices: Int
    /// "3:45 pm", when a sale was rung up today.
    let lastSale: String?
    let week: [DashDay]
    var linked = false

    private var line: String {
        if invoices == 0 { return "No invoices yet today" }
        var s = "\(invoices) invoice\(invoices == 1 ? "" : "s")"
        if let lastSale, !lastSale.isEmpty { s += " · last sale \(lastSale)" }
        return s
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                DashLabel("Taken today", font: .caption.weight(.semibold))
                Spacer(minLength: 8)
                if linked { DashChevron() }
            }
            HeroAmount(amount: amount, lac: true)
            Text(line)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .lineLimit(2)
            if week.contains(where: { $0.amount > 0 }) {
                DashWeekBars(days: week)
                    .padding(.top, 6)
            }
        }
        .ledgerCard(padding: 18)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Taken today, \(Money.pkrLac(amount)), \(line)")
    }
}

/// Seven days as bars, no axes: today's in the accent, the six before it faint, on a hairline so a day with
/// nothing still has its place.
struct DashWeekBars: View {
    let days: [DashDay]

    var body: some View {
        let today = days.last?.id
        VStack(spacing: 4) {
            Chart {
                ForEach(days) { (d: DashDay) in
                    BarMark(x: .value("Day", DashDate.weekdayDayMonth(d.day)), y: .value("Taken", d.amount))
                        .foregroundStyle(d.id == today ? Theme.accent : Theme.accent.opacity(0.25))
                        .cornerRadius(3)
                }
                RuleMark(y: .value("Nothing", 0.0))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                    .foregroundStyle(Color.secondary.opacity(0.2))
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 44)
            .accessibilityLabel("Taken each day over the last 7 days")
            HStack {
                Text("Last 7 days")
                Spacer()
                Text("Today")
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
        }
    }
}

// MARK: The three cards

/// One of the three small cards under Today: its name, its figure, a line under it. Cards side by side stand
/// the same height (the row is sized to the tallest).
struct DashStat<Content: View>: View {
    let label: String
    var linked = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                DashLabel(label).lineLimit(2)
                Spacer(minLength: 0)
                if linked { DashChevron() }
            }
            content()
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .ledgerCard(padding: 12)
        .accessibilityElement(children: .combine)
    }
}

/// A card's sum: "PKR" small beside the lac, as the hero sets it.
struct DashStatAmount: View {
    let amount: Double
    var tint: Color = .primary

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text("PKR")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(Money.lacCrore(amount))
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(tint)
                .contentTransition(.numericText(value: amount))
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Money.pkrLac(amount))
    }
}

/// A card's figure that is not money: "5 pieces", "Nil".
struct DashStatValue: View {
    let text: String
    var tint: Color = .primary

    var body: some View {
        Text(text)
            .font(.headline)
            .monospacedDigit()
            .foregroundStyle(tint)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}

/// The line under a card's figure.
struct DashStatNote: View {
    let text: String
    var tint: Color = .secondary

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(tint)
            .monospacedDigit()
            .lineLimit(2)
    }
}

/// This month against last: "+12%" once it has passed the whole of last month, else how far along it is ("62% of Sep").
struct DashMonthChange: View {
    let ratio: Double?
    let now: Date

    var body: some View {
        if let ratio {
            let last = DashDate.lastMonth(now)
            if ratio > 1 {
                let up = max(1, Int(((ratio - 1) * 100).rounded()))
                Pill("+\(up)%", tone: .settled)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(up)% more than all of \(DashDate.monthName(last))")
            } else {
                let share = Int((ratio * 100).rounded())
                Pill("\(share)% of \(DashDate.shortMonth(last))", tone: .quiet)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(share)% of \(DashDate.monthName(last))")
            }
        } else {
            DashStatNote(text: DashDate.monthName(now))
        }
    }
}

// MARK: Headings and cards of rows

/// A section's heading: its name and count (LedgerHeading), and the web's "All" when there is a list to open.
struct DashHeader: View {
    let title: String
    var count: Int?
    var allPath: String?
    /// What VoiceOver calls the "All" link: "All orders".
    var allLabel: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            LedgerHeading(title: title, count: count)
            if let allPath {
                NavigationLink(value: Route(path: allPath)) {
                    HStack(spacing: 2) {
                        Text("All")
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(allLabel ?? "All")
            }
        }
        .padding(.horizontal, 4)
    }
}

/// Rows with a hairline between them, set in from the leading edge past what each row leads with.
struct DashRows<Item: Identifiable, Row: View>: View {
    let items: [Item]
    var inset: CGFloat = 0
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
            if index > 0 { Divider().padding(.leading, inset) }
            row(item)
        }
    }
}

extension View {
    /// A list's rows on one ledger card.
    func dashRowsCard() -> some View {
        VStack(spacing: 0) { self }
            .padding(.horizontal, 14)
            .ledgerCard(padding: 0)
    }
}

/// What a section says when it has nothing: one quiet line.
struct DashEmpty: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 16)
    }
}

/// "Needs you" with nothing in it: calm, in the settled tone.
struct DashAllClear: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(Tone.settled.color)
            Text("All clear")
                .font(.subheadline.weight(.semibold))
            Text("Nothing late, unpaid or waiting")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 14)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("All clear: nothing late, unpaid or waiting")
    }
}

// MARK: Needs you

/// The rows of "Needs you", their symbols sized with the reader's text.
struct DashNeedList: View {
    let needs: [DashNeed]
    /// Opens the rate form for a row that asks for today's rate. Nil (anyone but an owner) leaves it a link.
    var onRates: (() -> Void)?

    @ScaledMetric(relativeTo: .subheadline) private var side: CGFloat = 30

    var body: some View {
        DashRows(items: needs, inset: side + 12) { (n: DashNeed) in
            DashNeedRow(need: n, side: side, onRates: onRates)
        }
    }
}

/// One thing waiting on a decision: what it is about (a symbol in its tone), what to know, what it comes to.
struct DashNeedRow: View {
    let need: DashNeed
    var side: CGFloat = 30
    var onRates: (() -> Void)?

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

    private var spoken: String {
        var s = "\(need.title). \(need.detail)"
        if let amount = need.amount { s += ". \(Money.pkrLac(amount))" }
        return s
    }

    var body: some View {
        if need.opensRates, let onRates {
            Button(action: onRates) { content }.buttonStyle(.plain)
        } else {
            NavigationLink(value: Route(path: need.path)) { content }.buttonStyle(.plain)
        }
    }

    private var content: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tone.color)
                .frame(width: side, height: side)
                .background(tone.color.opacity(0.13), in: .rect(cornerRadius: side * 0.3, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(need.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(need.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: 8)
            if let amount = need.amount {
                RowAmount(amount: amount, lac: true)
            }
            DashChevron()
        }
        .padding(.vertical, 11)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
    }
}

// MARK: Due to customers

/// A promise to a customer, an order or a repair: the promised day as a leaf, who, which, and either how it
/// stands (late or today) or what it comes to.
struct DashDueRow: View {
    let due: DashDue

    /// The size of the leaf, so the hairlines can be set in past it.
    static let leaf: CGFloat = 40

    private var leafTone: Tone {
        switch due.timing.state {
        case .late: return .late
        case .today: return .owed
        default: return .quiet
        }
    }

    private var pressing: Bool { due.timing.state == .late || due.timing.state == .today }

    /// "ORD-000123", "Repair · REP-000045"; with the sum when the right-hand side is taken by how it stands.
    private var refText: String {
        pressing && due.amount > 0 ? "\(due.refLine) · \(Money.pkr(due.amount))" : due.refLine
    }

    private var spoken: String {
        let words = PromiseWords.say(due.timing).text
        var s = "\(due.customer), \(due.isRepair ? "repair" : "order") \(due.ref), \(words)"
        if due.amount > 0 { s += ", \(Money.pkr(due.amount))" }
        return s
    }

    var body: some View {
        NavigationLink(value: Route(path: due.path)) {
            HStack(spacing: 12) {
                DateLeaf(date: due.timing.due, tone: leafTone, size: Self.leaf)
                VStack(alignment: .leading, spacing: 2) {
                    Text(due.customer)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(refText)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .monospacedDigit()
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                trailing
                DashChevron()
            }
            .padding(.vertical, 9)
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var trailing: some View {
        let words = PromiseWords.say(due.timing)
        if pressing {
            Pill(words.text, tone: words.tone)
        } else if due.amount > 0 {
            RowAmount(amount: due.amount)
        } else {
            Pill(words.text, tone: .quiet)
        }
    }
}

// MARK: Recent sales

/// A recent sale: who (a monogram and the name), when, what it was worth, and whether it is paid.
struct DashSaleRow: View {
    let invoice: Invoice

    /// The size of the monogram, so the hairlines can be set in past it.
    static let monogram: CGFloat = 34

    private var name: String { DashText.name(invoice.customerName) }
    private var when: String { ShopDate.say(invoice.createdAt, withTime: true) }

    /// Paid, what is still due, or the customer's credit; a refund says so instead.
    private var standing: (text: String, tone: Tone) {
        if invoice.status == .refunded { return ("Refunded", .quiet) }
        let b = balanceLine(invoice.balanceDue)
        switch b.state {
        case .paid: return ("Paid", .settled)
        case .due: return ("\(Money.pkrLac(b.amount)) due", .owed)
        case .credit: return ("In credit", .credit)
        }
    }

    var body: some View {
        NavigationLink(value: Route(path: DashPath.invoice(invoice.id))) {
            HStack(spacing: 12) {
                Monogram(name: invoice.customerName, size: Self.monogram)
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Text(when)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 3) {
                    RowAmount(amount: invoiceSaleValue(invoice), lac: true)
                    Pill(standing.text, tone: standing.tone)
                }
                DashChevron()
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), \(when), \(Money.pkrLac(invoiceSaleValue(invoice))), \(standing.text)")
        }
        .buttonStyle(.plain)
    }
}

// MARK: The last 30 days

/// Revenue, expenses and net over the last 30 days, and the days drawn quietly beneath. Expenses and net are
/// the owners' books, so staff see revenue alone.
struct DashMonthCard: View {
    let figures: DashFigures
    let showCosts: Bool
    var linked = false

    private var netTint: Color {
        if figures.net30 > 0.5 { return Tone.settled.color }
        if figures.net30 < -0.5 { return Tone.late.color }
        return .primary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                stat("Revenue", figures.revenue30, .primary)
                if showCosts {
                    stat("Expenses", figures.expenses30, .primary)
                    stat("Net", figures.net30, netTint)
                }
                if linked { DashChevron() }
            }
            if figures.revenue30 > 0 { chart }
        }
        .ledgerCard()
    }

    private func stat(_ label: String, _ value: Double, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            DashLabel(label)
            Text(Money.pkrLac(value))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentTransition(.numericText(value: value))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var chart: some View {
        VStack(spacing: 4) {
            Chart(figures.days) { (d: DashDay) in
                AreaMark(x: .value("Day", d.day), y: .value("Taken", d.amount))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Theme.accent.opacity(0.18))
                LineMark(x: .value("Day", d.day), y: .value("Taken", d.amount))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Theme.accent)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 72)
            .accessibilityLabel("Taken each day over the last 30 days")
            HStack {
                Text(DashDate.dayMonth(figures.days.first?.day ?? figures.now))
                Spacer()
                Text("Today")
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
        }
    }
}
