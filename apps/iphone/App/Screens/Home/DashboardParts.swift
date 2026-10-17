import SwiftUI
import Charts
import ERPCore

// The dashboard's pieces (src/app/page.tsx: Headline, Panel, TaskRow, DueRow, RecentInvoiceRow, the 30-day link),
// redrawn on the ledger (App/UI/Ledger.swift, 2026-10-09): one hero for today, two small cards under it, and
// each list a card of two-line rows that lead with what they are about (a tone's dot, a promised day, a person).
// Quiet (CONVENTIONS.md rule 15, 2026-10-17): the normal state says nothing, one colour per row, a figure once.
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
        .heroSheen(padding: 18)
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

// MARK: The small cards

/// One of the small cards under Today: its name, its figure, a line under it. Cards side by side stand
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

/// This month against last: "+12% on Sep" once it has passed the whole of last month, else how far along it is
/// ("62% of Sep"). Quiet words, not a badge: it is a fact, not something to act on.
struct DashMonthChange: View {
    let ratio: Double?
    let now: Date

    var body: some View {
        if let ratio {
            let last = DashDate.lastMonth(now)
            if ratio > 1 {
                let up = max(1, Int(((ratio - 1) * 100).rounded()))
                DashStatNote(text: "+\(up)% on \(DashDate.shortMonth(last))")
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(up)% more than all of \(DashDate.monthName(last))")
            } else {
                let share = Int((ratio * 100).rounded())
                DashStatNote(text: "\(share)% of \(DashDate.shortMonth(last))")
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

// MARK: Needs you

/// The rows of "Needs you".
struct DashNeedList: View {
    let needs: [DashNeed]
    /// Opens the rate sheet for a row that asks for today's rate. Nil leaves it a link.
    var onRates: (() -> Void)?

    var body: some View {
        DashRows(items: needs, inset: DashNeedRow.dot + 12) { (n: DashNeed) in
            DashNeedRow(need: n, onRates: onRates)
        }
    }
}

/// One thing waiting on a decision: a dot in its tone (the row's one colour; a data row has no symbol, rule 15),
/// what it is, one line to know, what it comes to.
struct DashNeedRow: View {
    let need: DashNeed
    var onRates: (() -> Void)?

    /// The tone's dot, so the hairlines can be set in past it.
    static let dot: CGFloat = 8

    /// Red for what is late, amber for what is owed or soon, quiet for a date worth knowing.
    private var tone: Tone {
        switch need.tone {
        case .danger: return .late
        case .warn: return .owed
        case .plain: return .quiet
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
            Circle()
                .fill(tone == .quiet ? Color.secondary.opacity(0.4) : tone.color)
                .frame(width: Self.dot, height: Self.dot)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(need.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(need.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
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
                // The leaf stays quiet: the words beside it carry a late or today promise's colour, once.
                DateLeaf(date: due.timing.due, tone: .quiet, size: Self.leaf)
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
            Text(words.text).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

// MARK: Recent sales

/// A recent sale: who (a monogram and the name), when, what it was worth, and only what needs a look:
/// still due, in credit or refunded. Paid is the normal state and says nothing (rule 15).
struct DashSaleRow: View {
    let invoice: Invoice

    /// The size of the monogram, so the hairlines can be set in past it.
    static let monogram: CGFloat = 34

    private var name: String { DashText.name(invoice.customerName) }
    private var when: String { ShopDate.say(invoice.createdAt, withTime: true) }

    /// What is still due, the customer's credit, or a refund; nil when paid.
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
                    if let standing { Pill(standing.text, tone: standing.tone) }
                }
                DashChevron()
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(name), \(when), \(Money.pkrLac(invoiceSaleValue(invoice))), \(standing?.text ?? "Paid")")
        }
        .buttonStyle(.plain)
    }
}

// MARK: This month

/// Revenue, expenses and net since the 1st, against last month in quiet words, and the days drawn beneath.
/// Expenses and net are the owners' books, so staff see revenue alone.
struct DashMonthCard: View {
    let figures: DashFigures
    let showCosts: Bool
    var linked = false

    private var netTint: Color {
        if figures.netMonth > 0.5 { return Tone.settled.color }
        if figures.netMonth < -0.5 { return Tone.late.color }
        return .primary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                stat("Revenue", figures.revenueMonth, .primary)
                if showCosts {
                    stat("Expenses", figures.expensesMonth, .primary)
                    stat("Net", figures.netMonth, netTint)
                }
                if linked { DashChevron() }
            }
            if figures.monthAgainstLast != nil { DashMonthChange(ratio: figures.monthAgainstLast, now: figures.now) }
            if figures.revenueMonth > 0 && figures.monthDays.count > 1 { chart }
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
            Chart(figures.monthDays) { (d: DashDay) in
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
            .accessibilityLabel("Taken each day this month")
            HStack {
                Text(DashDate.dayMonth(figures.monthDays.first?.day ?? figures.now))
                Spacer()
                Text("Today")
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .accessibilityHidden(true)
        }
    }
}
