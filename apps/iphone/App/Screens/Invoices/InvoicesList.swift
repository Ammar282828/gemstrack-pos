import SwiftUI
import ERPCore

/// How the list is broken up (invoices/page.tsx `groupBy`): by day to start (the owner, 2026-10-05),
/// or by status to chase what is still owed.
enum InvoiceGrouping: String, CaseIterable, Identifiable {
    case day, week, month, status

    var id: String { rawValue }

    var title: String {
        switch self {
        case .day: return "Day"
        case .week: return "Week"
        case .month: return "Month"
        case .status: return "Status"
        }
    }
}

/// The page's tabs and statuses as one row of chips: what is owed, what is settled, what is in credit.
enum InvoiceChip: String, CaseIterable, Identifiable {
    case all, unpaid, paid, credit, shopify

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .unpaid: return "Unpaid"
        case .paid: return "Paid"
        case .credit: return "In credit"
        case .shopify: return "Shopify"
        }
    }

    func matches(_ inv: Invoice) -> Bool {
        switch self {
        case .all:
            return true
        case .unpaid:
            return isOwing(inv)
        case .paid:
            return inv.status != .refunded && balanceLine(inv.balanceDue).state == .paid
        case .credit:
            return inv.status != .refunded && balanceLine(inv.balanceDue).state == .credit
        case .shopify:
            return (inv.source ?? "").hasPrefix("shopify")
        }
    }
}

/// One section of the list, with what it is worth and what is still owed on it.
struct InvoiceSection: Identifiable {
    let id: String
    let title: String
    /// A word under the heading when nothing is owed on it ("Oldest first"); "" for none.
    let hint: String
    let rows: [Invoice]
    let billed: Double
    let owed: Double
}

/// The three figures at the head of the list: billed today, billed this month, still owed. Each is a tap to
/// the invoices it counts (today's, this month's, the Unpaid chip).
struct InvoiceSummary {
    enum Figure { case today, month, owed }

    var today = 0.0
    var todayCount = 0
    var month = 0.0
    var monthCount = 0
    var owed = 0.0
    var owedCount = 0

    /// Billed as the sections bill (each invoice's grand total, as the web's list sums a day), and owed by the
    /// ERP's one rule (lib/owed.ts `owedToYou`, invoices alone: the list has no hisaab).
    static func of(_ rows: [Invoice], now: Date) -> InvoiceSummary {
        var s = InvoiceSummary()
        let today = ERPDate.karachiDay(now)
        let month = String(today.prefix(7))
        // Reading a date is the slow part at ten times the books: anything stamped well before this month is passed
        // over by its text ("2026-08-…" sorts before the floor), and only the rest is read as Karachi's day.
        let floor = String(ERPDate.iso(now.addingTimeInterval(-35 * 86_400)).prefix(10))
        for inv in rows {
            if String(inv.createdAt.prefix(10)) < floor { continue }
            guard let made = ERPDate.parse(inv.createdAt) else { continue }
            let day = ERPDate.karachiDay(made)
            guard day.hasPrefix(month) else { continue }
            s.month += inv.grandTotal
            s.monthCount += 1
            if day == today {
                s.today += inv.grandTotal
                s.todayCount += 1
            }
        }
        let owed = owedToYou(rows)
        s.owed = owed.total
        s.owedCount = owed.invoices.count
        return s
    }
}

/// Karachi's days, weeks (from Monday) and months: what the shop means by "today" and "this week".
enum InvoiceCalendar {
    static let karachi: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = ERPDate.karachi
        c.firstWeekday = 2
        c.minimumDaysInFirstWeek = 4
        return c
    }()

    private static func formatter(_ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = pattern
        return f
    }

    private static let dayName = formatter("EEEE d MMM")
    private static let shortDay = formatter("d MMM")
    private static let fullDay = formatter("d MMM yyyy")
    private static let yearOnly = formatter("yyyy")
    private static let monthName = formatter("MMMM yyyy")
    private static let monthParse = formatter("yyyy-MM")

    struct Bucket {
        let key: String
        let title: String
        let hint: String
    }

    static func bucket(_ d: Date, by grouping: InvoiceGrouping, now: Date) -> Bucket {
        switch grouping {
        case .month:
            let start = karachi.dateInterval(of: .month, for: d)?.start ?? d
            let thisMonth = karachi.isDate(start, equalTo: now, toGranularity: .month)
            return Bucket(key: "m\(Int(start.timeIntervalSince1970))", title: monthName.string(from: start), hint: thisMonth ? "This month" : "")
        case .week:
            let start = karachi.dateInterval(of: .weekOfYear, for: d)?.start ?? d
            let thisWeek = karachi.isDate(start, equalTo: now, toGranularity: .weekOfYear)
            return Bucket(key: "w\(Int(start.timeIntervalSince1970))", title: "Week of " + shortDay.string(from: start), hint: thisWeek ? "This week" : yearOnly.string(from: start))
        case .day, .status:
            let key = ERPDate.karachiDay(d)
            let today = key == ERPDate.karachiDay(now)
            let yesterday = key == ERPDate.karachiDay(now.addingTimeInterval(-86_400))
            let title = today ? "Today" : (yesterday ? "Yesterday" : dayName.string(from: d))
            return Bucket(key: "d" + key, title: title, hint: today || yesterday ? fullDay.string(from: d) : yearOnly.string(from: d))
        }
    }

    private static let dayOfYear = formatter("EEEE d MMM yyyy")
    private static let shortDayOfYear = formatter("d MMM yyyy")
    private static let monthOnly = formatter("MMMM")

    /// A section's heading in the ledger (Invoices, 2026-10-09): "Today", "Yesterday", "Wednesday 7 Oct", "This
    /// week", "Week of 28 Sep", "October"; the year only when it is not this one, so a heading never wraps.
    static func heading(_ d: Date, by grouping: InvoiceGrouping, now: Date) -> String {
        let thisYear = karachi.isDate(d, equalTo: now, toGranularity: .year)
        switch grouping {
        case .month:
            let start = karachi.dateInterval(of: .month, for: d)?.start ?? d
            return (thisYear ? monthOnly : monthName).string(from: start)
        case .week:
            let start = karachi.dateInterval(of: .weekOfYear, for: d)?.start ?? d
            if karachi.isDate(start, equalTo: now, toGranularity: .weekOfYear) { return "This week" }
            let sameYear = karachi.isDate(start, equalTo: now, toGranularity: .year)
            return "Week of " + (sameYear ? shortDay : shortDayOfYear).string(from: start)
        case .day, .status:
            let key = ERPDate.karachiDay(d)
            if key == ERPDate.karachiDay(now) { return "Today" }
            if key == ERPDate.karachiDay(now.addingTimeInterval(-86_400)) { return "Yesterday" }
            return (thisYear ? dayName : dayOfYear).string(from: d)
        }
    }

    /// The day a date picker shows, as "yyyy-MM-dd": the phone's own calendar (the 6th is the 6th wherever
    /// the phone is), whatever time of day the picker holds.
    static func day(picked: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: picked)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 1, c.day ?? 1)
    }

    /// A "yyyy-MM-dd" day as a date for a picker to show, in the phone's own calendar.
    static func picked(day: String?) -> Date? {
        guard let day, day.count == 10 else { return nil }
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// "1 Oct – 8 Oct 2026", or "From 1 Oct 2026" while the end is open (up to today).
    static func caption(from: String, to: String?) -> String {
        guard let start = ERPDate.parse(from) else { return from }
        guard let to, let end = ERPDate.parse(to) else { return "From " + fullDay.string(from: start) }
        return shortDay.string(from: start) + " – " + fullDay.string(from: end)
    }

    /// "2026-10" as the shop's month filter keeps it.
    static func monthKey(_ iso: String) -> String? {
        ERPDate.parse(iso).map { String(ERPDate.karachiDay($0).prefix(7)) }
    }

    static func monthLabel(_ key: String) -> String {
        monthParse.date(from: key).map { monthName.string(from: $0) } ?? key
    }
}

/// Every invoice, and what is still owed on it (src/app/invoices/page.tsx), as the ledger (Ledger.swift): the
/// chips and the three figures scroll with the list, so the large title stays clear; a day's heading says what it
/// billed and what is still owed on it; a row leads with who, says what was sold, and carries one pill.
struct InvoicesList: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var search = ""
    @State private var chip: InvoiceChip = .all
    @State private var grouping: InvoiceGrouping = .day
    /// "" is Anyone.
    @State private var takenBy = ""
    /// "" is all time, else "yyyy-MM".
    @State private var month = ""
    /// A span of days, "yyyy-MM-dd": from the first to the last, or to today while the end is open.
    /// Nothing without a start, as the web's date picker has it (invoices/page.tsx).
    @State private var rangeFrom: String?
    @State private var rangeTo: String?
    @State private var pickingRange = false
    @State private var paying: Invoice?
    /// Send on WhatsApp from a swipe: the invoice page's own send (InvoiceWhatsAppSend).
    @State private var sending: Invoice?
    @State private var pdf: InvoicePDFTarget?
    @State private var note: InvoiceNote?
    /// The ERP's own page for what has no native screen yet.
    @State private var web: Route?

    private var canPay: Bool { InvoiceFacts.mayTakePayments(role: session.role) }

    var body: some View {
        let all = book.invoices.items
        ShelfState(loaded: book.invoices.loaded, error: book.invoices.error, offline: book.invoices.offline) {
            content(all)
        }
        .navigationTitle("Invoices")
        .searchable(text: $search, prompt: "Customer, phone, piece, invoice or SKU")
        .toolbar {
            ToolbarItem(placement: .primaryAction) { filterMenu(all) }
        }
        .invoicePaymentSheet(for: $paying)
        .invoiceWhatsAppSend($sending, web: $web) { sent in withAnimation { note = sent } }
        .invoiceNoteBanner($note)
        .sheet(isPresented: $pickingRange) {
            InvoiceRangeSheet(from: rangeFrom, to: rangeTo) { from, to in
                rangeFrom = from
                rangeTo = from == nil ? nil : to
            }
        }
        .navigationDestination(item: $web) { r in
            ScreenRegistry.view(for: r.path)
                .navigationTitle("Invoices")
                .navigationBarTitleDisplayMode(.inline)
        }
        .navigationDestination(item: $pdf) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .task {
            book.invoices.need()
            book.customers.need()
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ all: [Invoice]) -> some View {
        let scoped = scope(all)
        let shown = scoped.filter { chip.matches($0) }
        let groups = sections(shown)
        List {
            // The chips and the figures are the list's first rows (a bar pinned over the list greyed the large title out).
            Section {
                ChipRow {
                    ForEach(visibleChips(scoped)) { c in
                        FilterChip(title: c.title, count: scoped.filter { c.matches($0) }.count, chosen: c == chip) {
                            withAnimation { chip = c }
                        }
                    }
                }
                summaryCard(all)
            }
            .chipRowInList()
            if groups.isEmpty {
                Section { emptyState }.houseRows()
            } else {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.rows) { inv in row(inv) }
                    } header: {
                        InvoiceSectionHeader(section: group)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    // MARK: The three figures

    /// Billed today, billed this month, still owed: the whole book's, or the chosen person's (Taken by), whatever
    /// else is filtered, so the figures hold still while the list below them is searched.
    private func summaryCard(_ all: [Invoice]) -> some View {
        let base = takenBy.isEmpty ? all : all.filter { $0.takenBy == takenBy }
        let s = InvoiceSummary.of(base, now: Date())
        return HStack(alignment: .top, spacing: 4) {
            InvoiceSummaryFigure(label: "Today", amount: s.today, count: s.todayCount,
                                 tone: .primary, chosen: chosen(.today)) { pick(.today) }
            InvoiceSummaryFigure(label: "This month", amount: s.month, count: s.monthCount,
                                 tone: .primary, chosen: chosen(.month)) { pick(.month) }
            InvoiceSummaryFigure(label: "Owed", amount: s.owed, count: s.owedCount,
                                 tone: s.owed > 0 ? Tone.owed.color : .secondary, chosen: chosen(.owed)) { pick(.owed) }
        }
        .ledgerCard(padding: 8)
    }

    private var todayKey: String { ERPDate.karachiDay(Date()) }
    private var monthKey: String { String(todayKey.prefix(7)) }

    /// Whether the list is showing what a figure counts.
    private func chosen(_ f: InvoiceSummary.Figure) -> Bool {
        switch f {
        case .today: return month.isEmpty && rangeFrom == todayKey && (rangeTo == nil || rangeTo == todayKey)
        case .month: return month == monthKey && rangeFrom == nil
        case .owed: return chip == .unpaid
        }
    }

    /// A figure tapped shows what it counts, through the filters the list already has; tapped again, lets go.
    private func pick(_ f: InvoiceSummary.Figure) {
        let again = chosen(f)
        withAnimation {
            switch f {
            case .today:
                month = ""
                rangeFrom = again ? nil : todayKey
                rangeTo = nil
            case .month:
                rangeFrom = nil
                rangeTo = nil
                month = again ? "" : monthKey
            case .owed:
                chip = again ? .all : .unpaid
            }
        }
    }

    private var emptyState: some View {
        let filtering = !search.isEmpty || !takenBy.isEmpty || !month.isEmpty || rangeFrom != nil || chip != .all
        return ContentUnavailableView(
            "Nothing found",
            systemImage: "doc.text.magnifyingglass",
            description: Text(filtering ? "Try adjusting your search or filter." : "No invoices have been created yet.")
        )
    }

    private func row(_ inv: Invoice) -> some View {
        InvoiceListRow(invoice: inv, mine: isMine(inv), dated: grouping != .day)
            // The bill to the customer: the commonest thing after a sale, the same send as the invoice page's.
            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                Button { sending = inv } label: { Label("Send on WhatsApp", systemImage: "message") }
                    .tint(Tone.working.color)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if canPay && isOwing(inv) {
                    Button { paying = inv } label: { Label("Take payment", systemImage: "banknote") }
                        .tint(Tone.settled.color)
                }
            }
            .contextMenu {
                if canPay && isOwing(inv) {
                    Button { paying = inv } label: { Label("Take payment", systemImage: "banknote") }
                }
                Button { sending = inv } label: {
                    Label(inv.sentOnWhatsApp == nil ? "Send on WhatsApp" : "Send again on WhatsApp", systemImage: "message")
                }
                Button { pdf = InvoiceFacts.pdfTarget(inv, byCustomer: session.shop.invoiceByCustomer) } label: {
                    Label("Print / PDF", systemImage: "printer")
                }
            }
            // The signed-in person's own sales are lit where they stand, not sorted or filtered (2026-10-05).
            .mineRow(isMine(inv))
    }

    private func isMine(_ inv: Invoice) -> Bool {
        guard let person = session.shop.person, !person.isEmpty, let by = inv.takenBy else { return false }
        return by == person
    }

    // MARK: Chips and the filter menu

    private func visibleChips(_ scoped: [Invoice]) -> [InvoiceChip] {
        InvoiceChip.allCases.filter { c in
            switch c {
            case .credit, .shopify:
                return c == chip || scoped.contains { c.matches($0) }
            case .all, .unpaid, .paid:
                return true
            }
        }
    }

    private func filterMenu(_ all: [Invoice]) -> some View {
        let people = Array(Set(all.compactMap { $0.takenBy }.filter { !$0.isEmpty })).sorted()
        let months = Array(Set(all.compactMap { InvoiceCalendar.monthKey($0.createdAt) })).sorted(by: >)
        let filtering = !takenBy.isEmpty || !month.isEmpty || rangeFrom != nil
        return Menu {
            Picker("Group by", selection: $grouping) {
                ForEach(InvoiceGrouping.allCases) { g in Text(g.title).tag(g) }
            }
            Picker("Taken by", selection: $takenBy) {
                Text("Anyone").tag("")
                ForEach(people, id: \.self) { p in Text(p).tag(p) }
            }
            Picker("Month", selection: $month) {
                Text("All time").tag("")
                ForEach(months, id: \.self) { m in Text(InvoiceCalendar.monthLabel(m)).tag(m) }
            }
            // Any span of days, on top of a month (the web's date range picker).
            Button { pickingRange = true } label: {
                Label(rangeFrom.map { InvoiceCalendar.caption(from: $0, to: rangeTo) } ?? "Date range", systemImage: "calendar")
            }
            if rangeFrom != nil {
                Button { rangeFrom = nil; rangeTo = nil } label: { Label("Clear the date range", systemImage: "xmark.circle") }
            }
            Divider()
            // Import Shopify CSV and the payment links are the ERP's own page.
            Button { web = Route(path: "/invoices?web=1") } label: { Label("Open in the ERP", systemImage: "globe") }
        } label: {
            Label("Filter", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    // MARK: Filtering and grouping

    /// Search, Taken by, Month and the date range: everything but the chip, so the chips can count what
    /// they would show.
    private func scope(_ all: [Invoice]) -> [Invoice] {
        var out = all
        if !takenBy.isEmpty { out = out.filter { $0.takenBy == takenBy } }
        if !month.isEmpty { out = out.filter { InvoiceCalendar.monthKey($0.createdAt) == month } }
        if let start = rangeFrom {
            // The last day included; open, it runs to the end of today (isWithinInterval, invoices/page.tsx).
            let end = rangeTo ?? ERPDate.karachiDay(Date())
            out = out.filter { inv in
                guard let made = ERPDate.parse(inv.createdAt) else { return false }
                let day = ERPDate.karachiDay(made)
                return day >= start && day <= end
            }
        }
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty {
            // The customer's own number, for an invoice that does not carry one.
            let digits = q.filter { $0 >= "0" && $0 <= "9" }
            let wanted = String(digits.drop(while: { $0 == "0" }))
            var phones: [String: String] = [:]
            if wanted.count >= 3 {
                for c in book.customers.items {
                    if let p = c.phone, !p.isEmpty { phones[c.id] = p }
                }
            }
            out = out.filter { matches($0, query: q, digits: wanted, phones: phones) }
        }
        return out
    }

    /// Customer, phone, invoice id, a piece's SKU or its name ("drop earrings": the counter remembers what was sold).
    private func matches(_ inv: Invoice, query q: String, digits: String, phones: [String: String]) -> Bool {
        if inv.id.localizedCaseInsensitiveContains(q) { return true }
        if inv.customerName.localizedCaseInsensitiveContains(q) { return true }
        if inv.items.contains(where: { $0.sku.localizedCaseInsensitiveContains(q) || $0.name.localizedCaseInsensitiveContains(q) }) { return true }
        if digits.count >= 3 {
            let own = inv.customerContact ?? ""
            let theirs = inv.customerId.flatMap { phones[$0] } ?? ""
            for p in [own, theirs] {
                let d = p.filter { $0 >= "0" && $0 <= "9" }
                if d.contains(digits) { return true }
            }
        }
        return false
    }

    private func sections(_ rows: [Invoice]) -> [InvoiceSection] {
        if grouping == .status { return statusSections(rows) }
        let now = Date()
        var order: [String] = []
        var titles: [String: String] = [:]
        var members: [String: [Invoice]] = [:]
        for inv in rows {
            let key: String
            if let d = ERPDate.parse(inv.createdAt) {
                key = InvoiceCalendar.bucket(d, by: grouping, now: now).key
                if titles[key] == nil { titles[key] = InvoiceCalendar.heading(d, by: grouping, now: now) }
            } else {
                key = "undated"
                if titles[key] == nil { titles[key] = "No date" }
            }
            if members[key] == nil { order.append(key) }
            members[key, default: []].append(inv)
        }
        return order.map { key in
            makeSection(id: key, title: titles[key] ?? "", hint: "", rows: members[key] ?? [])
        }
    }

    /// Awaiting payment (the oldest debt first: that is the one to chase), then Settled.
    private func statusSections(_ rows: [Invoice]) -> [InvoiceSection] {
        let owing = rows.filter { isOwing($0) }.sorted { $0.createdAt < $1.createdAt }
        let settled = rows.filter { !isOwing($0) }
        var out: [InvoiceSection] = []
        if !owing.isEmpty { out.append(makeSection(id: "owing", title: "Awaiting payment", hint: "Oldest first", rows: owing)) }
        if !settled.isEmpty { out.append(makeSection(id: "settled", title: "Settled", hint: "Nothing outstanding", rows: settled)) }
        return out
    }

    private func makeSection(id: String, title: String, hint: String, rows: [Invoice]) -> InvoiceSection {
        var billed = 0.0
        var owed = 0.0
        for inv in rows {
            billed += inv.grandTotal
            if isOwing(inv) { owed += inv.balanceDue }
        }
        return InvoiceSection(id: id, title: title, hint: hint, rows: rows, billed: billed, owed: owed)
    }
}

/// One of the three figures: its word, the sum in lac, how many invoices; lit while the list shows what it counts.
private struct InvoiceSummaryFigure: View {
    let label: String
    let amount: Double
    let count: Int
    let tone: Color
    let chosen: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(0.6)
                    .foregroundStyle(chosen ? Theme.accent : Color.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(alignment: .firstTextBaseline, spacing: 3) {
                    if amount > 0.5 {
                        Text("PKR").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                    }
                    Text(amount > 0.5 ? HeroAmount.figure(amount, lac: true) : "Nil")
                        .font(.system(.headline, design: .serif).weight(.semibold))
                        .foregroundStyle(amount > 0.5 ? tone : Color.secondary)
                        .monospacedDigit()
                        .contentTransition(.numericText(value: amount))
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                Text("\(count) invoice\(count == 1 ? "" : "s")")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .background(chosen ? Theme.accent.opacity(0.12) : Color.clear, in: .rect(cornerRadius: 14, style: .continuous))
            .contentShape(Rectangle())
        }
        // Its own tap: three buttons in one list row each answer for themselves.
        .buttonStyle(.borderless)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// A section's heading: its day, how many, what it billed; under it what is still owed on it.
private struct InvoiceSectionHeader: View {
    let section: InvoiceSection

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            LedgerHeading(title: section.title, count: section.rows.count, trailing: Money.pkrLac(section.billed))
            if section.owed > 0.5 {
                Text(section.hint.isEmpty ? "\(Money.pkr(section.owed)) still owed" : "\(section.hint) · \(Money.pkr(section.owed)) still owed")
                    .font(.caption.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(Tone.owed.color)
            } else if !section.hint.isEmpty {
                Text(section.hint).font(.caption).foregroundStyle(.secondary)
            }
        }
        .textCase(nil)
        .padding(.bottom, 2)
    }
}

/// One invoice: who it was for, what was sold, its number and time, what it came to and where its balance stands.
private struct InvoiceListRow: View {
    let invoice: Invoice
    /// Taken by whoever is signed in.
    let mine: Bool
    /// Grouped by more than a day: the row says its day, not only its time.
    let dated: Bool

    var body: some View {
        NavigationLink(value: Route(path: InvoiceFacts.path(invoice.id))) {
            HStack(alignment: .top, spacing: 12) {
                Monogram(name: invoice.customerName, size: 38)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(InvoiceFacts.customerName(invoice))
                            .font(.headline)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        RowAmount(amount: invoice.grandTotal)
                    }
                    HStack(alignment: .center, spacing: 8) {
                        Text(InvoiceFacts.whatSold(invoice) ?? "No pieces")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        InvoiceBalancePill(invoice: invoice)
                    }
                    HStack(spacing: 6) {
                        Text(reference)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                            .monospacedDigit()
                            .lineLimit(1)
                        if mine { MineTag() }
                    }
                }
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)
        }
    }

    /// "INV-000123 · 3:45 pm" under its day's heading, "INV-000123 · Tue 6 Oct" under a week's; "· Shopify" for an import.
    private var reference: String {
        var parts = [invoice.id]
        let when = dated ? ShopDate.say(invoice.createdAt) : InvoiceFacts.time(invoice.createdAt)
        if !when.isEmpty { parts.append(when) }
        if (invoice.source ?? "").hasPrefix("shopify") { parts.append("Shopify") }
        return parts.joined(separator: " · ")
    }
}

/// Pick the days to look at: from a first day to a last, or from a first day up to today. Cleared from
/// the filter menu. A sheet of its own, so it has its own stack (the web uses a popover calendar).
private struct InvoiceRangeSheet: View {
    let apply: (_ from: String?, _ to: String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var from: Date
    @State private var until: Date
    @State private var hasEnd: Bool

    init(from: String?, to: String?, apply: @escaping (_ from: String?, _ to: String?) -> Void) {
        self.apply = apply
        let start = InvoiceCalendar.picked(day: from) ?? Date()
        _from = State(initialValue: start)
        _until = State(initialValue: InvoiceCalendar.picked(day: to) ?? start)
        _hasEnd = State(initialValue: to != nil)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("From", selection: $from, displayedComponents: .date)
                    Toggle("Up to a last day", isOn: $hasEnd.animation())
                    if hasEnd {
                        DatePicker("To", selection: $until, in: from..., displayedComponents: .date)
                    }
                } footer: {
                    Text(hasEnd ? "Both days are included." : "Everything from that day up to today.")
                }
            }
            .navigationTitle("Date range")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) {
                        let start = InvoiceCalendar.day(picked: from)
                        // A last day set before the first reads as that one day.
                        let end = hasEnd ? max(start, InvoiceCalendar.day(picked: until)) : nil
                        apply(start, end)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
