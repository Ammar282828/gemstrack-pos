import SwiftUI
import ERPCore

/// Home → Today's cash (src/app/today/page.tsx): what came in today by how it was paid, what went
/// out, and what the drawer should have gained. Every figure is ERPCore's `todaysCash` (the 9 pm
/// report's "Net cash" reads the same rule); Karachi's day, re-read once a minute so a screen left
/// open turns over at midnight.
///
/// The view is TodaysCashScreen, not TodaysCash: ERPCore already has a TodaysCash (the result), and
/// a second type of that name in the app would hide it from every other screen.
///
/// Owners only, as on the web's menu (nav.ts has no `staff` on Today's cash): the drawer is worked out from
/// expenses and extra revenue, which are the owners' books. Anyone else is told so and nothing is read for them.
struct TodaysCashScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var now = Date()

    var body: some View {
        Group {
            if session.isOwner {
                ShelfState(loaded: ready, error: book.invoices.error ?? book.orders.error, offline: book.invoices.offline) {
                    page(todaysCash(invoices: book.invoices.items, orders: book.orders.items, repairs: book.repairs.items,
                                    extraRevenues: book.revenue.items, expenses: book.expenses.items, now: now))
                }
                .onAppear { needAll() }
                .task { await keepTime() }
            } else {
                ContentUnavailableView("Owners only", systemImage: "lock")
            }
        }
        .navigationTitle("Today’s cash")
    }

    private func needAll() {
        guard session.isOwner else { return }
        book.invoices.need()
        book.orders.need()
        book.repairs.need()
        book.revenue.need()
        book.expenses.need()
    }

    private var ready: Bool {
        book.invoices.loaded && book.orders.loaded && book.repairs.loaded && book.revenue.loaded && book.expenses.loaded
    }

    /// Re-read once a minute, so a page left open turns over at Karachi's midnight.
    private func keepTime() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(60))
            now = Date()
        }
    }

    // MARK: The page

    private func page(_ t: TodaysCash) -> some View {
        List {
            Section {
                tiles(t)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text(DashDate.dayLabel(now)).textCase(nil)
            }
            Section("By how it was paid") {
                ForEach(METHODS, id: \.self) { (m: CashMethod) in
                    methodRow(m, t.byMethod[m] ?? 0)
                }
            }
            Section("Came in") {
                if t.lines.isEmpty {
                    Text("Nothing yet today.").foregroundStyle(.secondary)
                } else {
                    ForEach(Array(t.lines.enumerated()), id: \.offset) { _, line in
                        cameInRow(line)
                    }
                }
            }
            if !t.expenseLines.isEmpty {
                Section {
                    ForEach(Array(t.expenseLines.enumerated()), id: \.offset) { _, e in
                        TwoLine(title: e.description, subtitle: e.category, trailing: Money.pkr(e.amount))
                    }
                } header: {
                    Text("Paid out")
                } footer: {
                    Text("Expenses carry no method, so every one the business paid today counts as leaving the drawer; one a partner paid out of pocket does not.")
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func tiles(_ t: TodaysCash) -> some View {
        let n = t.expenseLines.count
        return VStack(spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                FigureTile(label: "In the drawer", value: Money.pkr(t.netCash), detail: "Cash in, less what was paid out",
                           tint: t.netCash < 0 ? Color.red : Theme.accent)
                FigureTile(label: "Money in", value: Money.pkr(t.totalIn), detail: "Every method")
            }
            HStack(alignment: .top, spacing: 10) {
                FigureTile(label: "Paid out", value: Money.pkr(t.expenses), detail: "\(n) expense\(n == 1 ? "" : "s")")
                FigureTile(label: "Exchange", value: Money.pkr(t.exchange), detail: "Taken in exchange — not cash")
            }
        }
        .padding(.vertical, 4)
    }

    private func methodRow(_ m: CashMethod, _ amount: Double) -> some View {
        LabeledContent(m.rawValue) {
            Text(Money.pkr(amount))
                .monospacedDigit()
                .foregroundStyle(amount == 0 ? Color.secondary : Color.primary)
        }
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

    private func cameInRow(_ l: CashLine) -> some View {
        // An Extra revenue line's ref is its own words; the others are a document and who it was for.
        let title = (l.source == .extra || l.who.isEmpty) ? l.ref : "\(l.ref) · \(l.who)"
        let subtitle = "\(sourceWord(l.source)) · \(l.method.rawValue) · \(DashDate.clock(iso: l.at))"
        return NavigationLink(value: Route(path: path(for: l))) {
            TwoLine(title: title, subtitle: subtitle, trailing: Money.pkr(l.amount))
        }
    }
}
