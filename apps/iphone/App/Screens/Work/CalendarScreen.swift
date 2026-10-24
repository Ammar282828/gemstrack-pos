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
    @State private var width: CGFloat = 0
    @Environment(\.layoutWidthClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// A day cell's height grows with the reader's text.
    @ScaledMetric(relativeTo: .caption) private var cellHeight: CGFloat = 60

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
        .hubTitleDisplay()
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Today") { goToday() }
                    .disabled(selected == CalendarScreen.todayKey())
            }
        }
        // A light tick as the month or the day changes.
        .selectionFeedback(trigger: selected)
        .selectionFeedback(trigger: year * 100 + month)
        .onAppear {
            guard session.role == "owner" || session.role == "staff" else { return }
            book.orders.need()
            book.invoices.need()
        }
    }

    private func goToday() {
        let t = ShopCalendar.today()
        Motion.run(reduce: reduceMotion) {
            year = t.year
            month = t.month
            selected = ShopCalendar.dayKey(year: t.year, month: t.month, day: t.day)
        }
    }

    private func step(_ delta: Int) {
        let next = ShopCalendar.step(year: year, month: month, by: delta)
        Motion.run(reduce: reduceMotion) {
            year = next.year
            month = next.month
        }
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
        Group {
            if wide {
                // An iPad: the month's grid on the left, the day chosen and what was promised for it beside it.
                HStack(alignment: .top, spacing: 0) {
                    List { monthSections(figures, books) }.listStyle(.insetGrouped)
                    List { daySection(books); dueSection() }.listStyle(.insetGrouped)
                }
            } else {
                List {
                    monthSections(figures, books)
                    daySection(books)
                    dueSection()
                }
                .listStyle(.insetGrouped)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private var wide: Bool { sizeClass.isPadLayout && width >= 820 && !typeSize.isAccessibilitySize }

    @ViewBuilder
    private func monthSections(_ figures: ShopCalendarMonth, _ books: Reckoned) -> some View {
        Section {
            tiles(figures)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
        }
        Section {
            monthGrid(books)
        } footer: {
            legend
        }
        .houseRows()
    }

    /// The month on screen: its money, its sales and orders, and the average day that took anything.
    private func tiles(_ m: ShopCalendarMonth) -> some View {
        VStack(spacing: 10) {
            FigureRow(alignment: .top, spacing: 10) {
                FigureTile(label: ShopCalendar.title(year: year, month: month), value: Money.pkrLac(m.total), tint: Tone.settled.color)
                FigureTile(label: "Sales", value: "\(m.sales)")
            }
            FigureRow(alignment: .top, spacing: 10) {
                FigureTile(label: "Orders", value: "\(m.orders)")
                FigureTile(label: "Average trading day", value: m.perTradingDay > 0 ? Money.pkrLac(m.perTradingDay) : "—")
            }
        }
        .padding(.vertical, 4)
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
                Button { step(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Previous month")
                Spacer()
                Text(ShopCalendar.title(year: year, month: month)).font(.headline)
                    .contentTransition(.numericText())
                Spacer()
                Button { step(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Next month")
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"], id: \.self) { (name: String) in
                    Text(name).font(.caption2).foregroundStyle(.secondary)
                }
                // A day is its own number; a blank before the 1st is told by its place, which never changes for a month.
                ForEach(cells.enumerated().map { (e: EnumeratedSequence<[Int?]>.Element) in CalendarCell(id: e.element.map { "d\($0)" } ?? "b\(e.offset)", day: e.element) }) { (cell: CalendarCell) in
                    if let day = cell.day {
                        dayCell(day, books: books, today: today)
                    } else {
                        Color.clear.frame(height: cellHeight)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .motion(year * 100 + month)
    }

    private struct CalendarCell: Identifiable {
        let id: String
        let day: Int?
    }

    private func dayCell(_ day: Int, books: Reckoned, today: String) -> some View {
        let key = ShopCalendar.dayKey(year: year, month: month, day: day)
        let data = books.days[key]
        let due = books.due[key] ?? 0
        let isSelected = key == selected
        let isToday = key == today
        return Button { Motion.run(reduce: reduceMotion) { selected = key } } label: {
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
                        .font(.caption2)
                        .foregroundStyle(Tone.owed.color)
                    }
                }
                .frame(minHeight: 12)
            }
            .frame(maxWidth: .infinity, minHeight: cellHeight)
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
            Text("\(n)").font(.caption2).foregroundStyle(color)
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
            LedgerHeading(title: "Events for \(ShopCalendar.longDay(selected))")
        }
        .houseRows()
    }

    private func eventRow(_ e: ShopCalendarEvent) -> some View {
        let path = e.isInvoice ? WorkPaths.invoice(e.docId) : WorkPaths.order(e.docId)
        return NavigationLink(value: Route(path: path)) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: e.isInvoice ? "receipt" : "list.clipboard")
                    .foregroundStyle(e.isInvoice ? Tone.settled.color : Tone.working.color)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.docId).font(.subheadline.monospaced().weight(.semibold)).lineLimit(1)
                    Text(e.customerName.isEmpty ? "Walk-in" : e.customerName)
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    Text(ShopCalendar.clock(iso: e.createdAt)).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                RowAmount(amount: e.grandTotal)
            }
        }
        .zoomSource(id: path)
    }

    /// The pieces promised for the day chosen (the promise layer on its own: it never touches the money above).
    @ViewBuilder
    private func dueSection() -> some View {
        let due = shopCalendarDueOn(selected, orders: book.orders.items)
        if !due.isEmpty {
            Section {
                ForEach(due) { o in
                    NavigationLink(value: Route(path: WorkPaths.order(o.id))) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "calendar.badge.clock").foregroundStyle(Tone.owed.color).frame(width: 24)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(o.id).font(.subheadline.monospaced().weight(.semibold)).lineLimit(1)
                                Text((o.customerName ?? "").isEmpty ? "Walk-in" : (o.customerName ?? ""))
                                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            // Completed is the expected end: no badge (rule 15).
                            if o.status != .completed { StatusBadge(order: o.status) }
                        }
                    }
                    .zoomSource(id: WorkPaths.order(o.id))
                }
            } header: {
                LedgerHeading(title: "Promised for this day")
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
