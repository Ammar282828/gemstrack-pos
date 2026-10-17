import SwiftUI
import ERPCore

/// Home → Calendar (src/app/calendar/page.tsx): sales and orders, day by day. A month in a grid, each day with the money
/// taken that day (a sale counts on the day its order was taken, as the dashboard and Analytics count it), how many
/// sales and orders it saw, and how many pieces were promised for it; the month's figures above; the day chosen below,
/// with its rows opening the invoice or order. Every figure is ERPCore's (`shopCalendarDays`): the money layer and the
/// promise layer are kept apart, as on the page.
///
/// Owners and staff, as the web's menu has it (nav.ts: Calendar is `staff: true`).
struct CalendarScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var year = ShopCalendar.today().year
    @State private var month = ShopCalendar.today().month
    /// The day chosen, "yyyy-MM-dd"; today to start with.
    @State private var selected = CalendarScreen.todayKey()
    @State private var reckoned = Memo<Reckoned>()

    private struct Reckoned {
        let days: [String: ShopCalendarDay]
        let due: [String: Int]
    }

    private static func todayKey() -> String {
        let t = ShopCalendar.today()
        return ShopCalendar.dayKey(year: t.year, month: t.month, day: t.day)
    }

    var body: some View {
        Group {
            if session.role == "owner" || session.role == "staff" {
                ShelfState(
                    loaded: book.orders.loaded && book.invoices.loaded,
                    error: book.orders.error ?? book.invoices.error,
                    offline: book.orders.offline
                ) {
                    page
                }
            } else {
                WorkNotYours(title: "Calendar", detail: "The shop's sales and orders are kept for its owners and staff.")
            }
        }
        .navigationTitle("Calendar")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Today") { goToday() }
            }
        }
        .onAppear {
            guard session.role == "owner" || session.role == "staff" else { return }
            book.orders.need()
            book.invoices.need()
        }
    }

    private func goToday() {
        let t = ShopCalendar.today()
        year = t.year
        month = t.month
        selected = ShopCalendar.dayKey(year: t.year, month: t.month, day: t.day)
    }

    private func step(_ delta: Int) {
        let next = ShopCalendar.step(year: year, month: month, by: delta)
        year = next.year
        month = next.month
    }

    // MARK: The page

    @ViewBuilder
    private var page: some View {
        let books = reckoned([book.orders.revision, book.invoices.revision]) {
            Reckoned(
                days: shopCalendarDays(invoices: book.invoices.items, orders: book.orders.items),
                due: shopCalendarDue(orders: book.orders.items)
            )
        }
        let figures = shopCalendarMonth(books.days, year: year, month: month)
        List {
            Section {
                tiles(figures)
                    .listRowInsets(EdgeInsets())
            }
            Section {
                monthGrid(books)
            } footer: {
                legend
            }
            .houseRows()
            daySection(books)
            dueSection()
        }
        .listStyle(.insetGrouped)
    }

    /// The month on screen: its money as the one hero figure, then one row of its sales, orders and average trading day.
    private func tiles(_ m: ShopCalendarMonth) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(ShopCalendar.title(year: year, month: month)).font(.subheadline).foregroundStyle(.secondary)
            HeroAmount(amount: m.total, lac: true)
            FigureRow(alignment: .top, spacing: 10) {
                FigureTile(label: "Sales", value: "\(m.sales)")
                FigureTile(label: "Orders", value: "\(m.orders)")
                FigureTile(label: "Avg. trading day", value: m.perTradingDay > 0 ? Money.pkrLac(m.perTradingDay) : "—")
            }
        }
        .padding(16)
    }

    private var legend: some View {
        HStack(spacing: 14) {
            Label("Sales", systemImage: "circle.fill").foregroundStyle(Tone.settled.color)
            Label("Orders", systemImage: "circle.fill").foregroundStyle(Tone.working.color)
            Label("Promised", systemImage: "calendar.badge.clock").foregroundStyle(Tone.owed.color)
        }
        .labelStyle(LegendLabel())
        .font(.caption)
    }

    // MARK: The month

    private func monthGrid(_ books: Reckoned) -> some View {
        let cells = ShopCalendar.cells(year: year, month: month)
        let today = CalendarScreen.todayKey()
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        return VStack(spacing: 8) {
            HStack {
                Button { step(-1) } label: { Image(systemName: "chevron.left").frame(width: 36, height: 32) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Previous month")
                Spacer()
                Text(ShopCalendar.title(year: year, month: month)).font(.headline)
                Spacer()
                Button { step(1) } label: { Image(systemName: "chevron.right").frame(width: 36, height: 32) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Next month")
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(Array(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].enumerated()), id: \.offset) { _, name in
                    Text(name).font(.caption2).foregroundStyle(.secondary)
                }
                ForEach(Array(cells.enumerated()), id: \.offset) { _, day in
                    if let day {
                        dayCell(day, books: books, today: today)
                    } else {
                        Color.clear.frame(height: 60)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func dayCell(_ day: Int, books: Reckoned, today: String) -> some View {
        let key = ShopCalendar.dayKey(year: year, month: month, day: day)
        let data = books.days[key]
        let due = books.due[key] ?? 0
        let isSelected = key == selected
        let isToday = key == today
        return Button { selected = key } label: {
            VStack(spacing: 1) {
                Text("\(day)")
                    .font(.caption.weight(isToday ? .bold : .medium))
                    .foregroundStyle(isToday ? Theme.accent : Color.primary)
                // The money taken that day, in a few characters; a day with nothing sold shows none.
                if let data, data.total > 0 {
                    Text(ShopCalendar.dayMoney(data.total))
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                } else {
                    Text(" ").font(.caption2)
                }
                HStack(spacing: 3) {
                    if let data, data.invoices > 0 { count(data.invoices, color: Tone.settled.color) }
                    if let data, data.orders > 0 { count(data.orders, color: Tone.working.color) }
                    if due > 0 {
                        HStack(spacing: 1) {
                            Image(systemName: "calendar.badge.clock")
                            Text("\(due)")
                        }
                        .font(.system(size: 9))
                        .foregroundStyle(Tone.owed.color)
                    }
                }
                .frame(minHeight: 12)
            }
            .frame(maxWidth: .infinity, minHeight: 60)
            .background(isSelected ? Theme.accent.opacity(0.16) : Color.clear, in: .rect(cornerRadius: Radius.thumb, style: .continuous))
            .overlay {
                if isToday { RoundedRectangle(cornerRadius: Radius.thumb, style: .continuous).strokeBorder(Theme.accent, lineWidth: 1.5) }
            }
            .contentShape(.rect(cornerRadius: Radius.thumb, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(spoken(key, data, due))
    }

    private func count(_ n: Int, color: Color) -> some View {
        HStack(spacing: 2) {
            Circle().fill(color).frame(width: 5, height: 5)
            Text("\(n)").font(.system(size: 9)).foregroundStyle(color)
        }
    }

    /// What a day says to VoiceOver: its date, the money, the sales and orders, and what was promised.
    private func spoken(_ key: String, _ data: ShopCalendarDay?, _ due: Int) -> String {
        var parts = [ShopCalendar.longDay(key)]
        if let data {
            if data.total > 0 { parts.append(Money.pkr(data.total)) }
            if data.invoices > 0 { parts.append("\(data.invoices) sale\(data.invoices == 1 ? "" : "s")") }
            if data.orders > 0 { parts.append("\(data.orders) order\(data.orders == 1 ? "" : "s")") }
        }
        if due > 0 { parts.append("\(due) promised") }
        return parts.joined(separator: ", ")
    }

    // MARK: The day

    private func daySection(_ books: Reckoned) -> some View {
        let events = books.days[selected]?.events ?? []
        return Section {
            if events.isEmpty {
                Text("No events for this day.").foregroundStyle(.secondary)
            } else {
                ForEach(events) { e in eventRow(e) }
            }
        } header: {
            LedgerHeading(title: ShopCalendar.longDay(selected), count: events.isEmpty ? nil : events.count)
        }
        .houseRows()
    }

    private func eventRow(_ e: ShopCalendarEvent) -> some View {
        let path = e.isInvoice ? WorkPaths.invoice(e.docId) : WorkPaths.order(e.docId)
        // Two lines (rule 15): who and the sum; then the number, sale or order, and the time.
        return NavigationLink(value: Route(path: path)) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(e.customerName.isEmpty ? "Walk-in" : e.customerName).font(.headline).lineLimit(1)
                    Spacer(minLength: 8)
                    Text(Money.pkr(e.grandTotal)).font(.subheadline.weight(.semibold)).monospacedDigit()
                }
                Text([e.docId, e.isInvoice ? "Sale" : "Order", ShopCalendar.clock(iso: e.createdAt)].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }

    /// The pieces promised for the day chosen (the promise layer on its own: it never touches the money above).
    @ViewBuilder
    private func dueSection() -> some View {
        let due = shopCalendarDueOn(selected, orders: book.orders.items)
        if !due.isEmpty {
            Section {
                ForEach(due) { o in
                    NavigationLink(value: Route(path: WorkPaths.order(o.id))) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text((o.customerName ?? "").isEmpty ? "Walk-in" : (o.customerName ?? "")).font(.headline).lineLimit(1)
                            Text(o.id + " · " + o.status.rawValue).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            } header: {
                LedgerHeading(title: "Promised for this day", count: due.count)
            }
            .houseRows()
        }
    }
}

/// The legend's small icon beside its word.
private struct LegendLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}
