import SwiftUI
import Charts
import ERPCore

// The dashboard's pieces (src/app/page.tsx: Panel, TaskRow, DueRow, RecentInvoiceRow, the 30-day link).
// Content sits on the system's own backgrounds; nothing here is glass (CONVENTIONS.md rule 4).
// There are no buttons: every row is a link to the place it names, and New sale is the app's bar.

/// A titled group of rows on a quiet card, with the web's "All" link when there is a list to open.
struct DashSection<Content: View>: View {
    let title: String
    let symbol: String
    var symbolTint: Color = .secondary
    var count: Int?
    var allPath: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            VStack(spacing: 0) { content() }
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.card, in: .rect(cornerRadius: 18))
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).foregroundStyle(symbolTint)
            Text(title).font(.headline)
            if let count, count > 0 {
                Text("\(count)").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer(minLength: 8)
            if let allPath {
                NavigationLink(value: Route(path: allPath)) {
                    HStack(spacing: 2) {
                        Text("All")
                        Image(systemName: "chevron.right").font(.caption2.weight(.semibold))
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 4)
    }
}

/// Rows with a hairline between them.
struct DashRows<Item: Identifiable, Row: View>: View {
    let items: [Item]
    @ViewBuilder let row: (Item) -> Row

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
            if index > 0 { Divider() }
            row(item)
        }
    }
}

/// What a section says when it has nothing.
struct DashEmpty: View {
    let text: String
    var symbol: String?

    var body: some View {
        VStack(spacing: 8) {
            if let symbol {
                Image(systemName: symbol).font(.title).foregroundStyle(.green)
            }
            Text(text).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
    }
}

/// One thing waiting on a decision.
struct DashNeedRow: View {
    let need: DashNeed

    private var dot: Color {
        switch need.tone {
        case .danger: return .red
        case .warn: return .orange
        case .plain: return Color.secondary.opacity(0.4)
        }
    }

    var body: some View {
        NavigationLink(value: Route(path: need.path)) {
            HStack(spacing: 12) {
                Circle().fill(dot).frame(width: 7, height: 7)
                VStack(alignment: .leading, spacing: 2) {
                    Text(need.title).font(.subheadline.weight(.medium)).lineLimit(2).multilineTextAlignment(.leading)
                    Text(need.detail).font(.caption).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 8)
                if let amount = need.amount {
                    Text(Money.pkrLac(amount)).font(.caption.weight(.semibold)).monospacedDigit()
                }
                Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A promise to a customer: an order or a repair, by the date it was promised.
struct DashDueRow: View {
    let due: DashDue

    private var tone: Color {
        switch due.timing.state {
        case .late: return .red
        case .today: return .orange
        default: return .secondary
        }
    }

    private var dot: Color {
        due.timing.state == .late || due.timing.state == .today ? tone : Color.secondary.opacity(0.4)
    }

    var body: some View {
        NavigationLink(value: Route(path: due.path)) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Circle().fill(dot).frame(width: 7, height: 7)
                    Text(due.customer).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(due.whenText).font(.caption.weight(.medium)).monospacedDigit().foregroundStyle(tone)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(due.refLine).font(.system(.caption, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1)
                    Spacer(minLength: 8)
                    if due.amount > 0 {
                        Text(Money.pkr(due.amount)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                .padding(.leading, 15)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A recent sale: who, what it was worth, and what is still owed on it.
struct DashSaleRow: View {
    let invoice: Invoice

    private var owing: Bool { invoice.balanceDue > 0 }

    private var owedWord: String {
        invoice.balanceDue >= invoice.grandTotal ? "unpaid" : "\(Money.pkrLac(invoice.balanceDue)) due"
    }

    var body: some View {
        NavigationLink(value: Route(path: DashPath.invoice(invoice.id))) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(DashText.name(invoice.customerName)).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(Money.pkrLac(invoiceSaleValue(invoice)))
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(owing ? Color.orange : Color.primary)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(ShopDate.say(invoice.createdAt)).font(.caption).foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    if owing {
                        Text(owedWord).font(.caption).foregroundStyle(.orange).monospacedDigit()
                    }
                }
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// The 30-day line at the bottom: revenue, expenses and net, and the days drawn quietly beneath.
/// Expenses and net are the owners' books, so staff see revenue alone.
struct DashMonthStrip: View {
    let figures: DashFigures
    let showCosts: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("LAST 30 DAYS")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 22) {
                stat("Revenue", figures.revenue30, .green)
                if showCosts {
                    stat("Expenses", figures.expenses30, .red)
                    stat("Net", figures.net30, figures.net30 >= 0 ? Theme.accent : Color.red)
                }
                Spacer(minLength: 0)
            }
            if figures.revenue30 > 0 { chart }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: .rect(cornerRadius: 18))
    }

    private func stat(_ label: String, _ value: Double, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(Money.pkrLac(value))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(tint)
                .monospacedDigit()
                .contentTransition(.numericText(value: value))
        }
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
        }
    }
}
