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
    let hint: String
    let danger: Bool
    let rows: [Invoice]
    let billed: Double
    let owed: Double
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

/// Every invoice, and what is still owed on it (src/app/invoices/page.tsx).
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
    /// The ERP's own page for what has no native screen yet.
    @State private var web: Route?

    private var canPay: Bool { InvoiceFacts.mayTakePayments(role: session.role) }

    var body: some View {
        let all = book.invoices.items
        ShelfState(loaded: book.invoices.loaded, error: book.invoices.error, offline: book.invoices.offline) {
            content(all)
        }
        .navigationTitle("Invoices")
        .searchable(text: $search, prompt: "Customer, phone, invoice or SKU")
        .toolbar {
            ToolbarItem(placement: .primaryAction) { filterMenu(all) }
        }
        .invoicePaymentSheet(for: $paying)
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
            Section { subtitle(all) }.houseRows()
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
        .safeAreaInset(edge: .top, spacing: 0) { chipRow(scoped) }
    }

    /// "Every invoice, and what is still owed on it", with the whole book's figure whatever the
    /// filters show (the dashboard's "Owed to you", invoices only: lib/owed.ts).
    @ViewBuilder
    private func subtitle(_ all: [Invoice]) -> some View {
        let owed = owedToYou(all)
        let count = owed.invoices.count
        VStack(alignment: .leading, spacing: 3) {
            Text("Every invoice, and what is still owed on it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if owed.total > 0 {
                Text("\(Money.pkr(owed.total)) owed on \(count) invoice\(count == 1 ? "" : "s")")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.red)
                    .monospacedDigit()
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
        InvoiceListRow(invoice: inv)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if canPay && isOwing(inv) {
                    Button { paying = inv } label: { Label("Take payment", systemImage: "banknote") }
                        .tint(.green)
                }
            }
            .contextMenu {
                if canPay && isOwing(inv) {
                    Button { paying = inv } label: { Label("Take payment", systemImage: "banknote") }
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

    private func chipRow(_ scoped: [Invoice]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(visibleChips(scoped)) { c in
                    chipButton(c, count: scoped.filter { c.matches($0) }.count)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
    }

    @ViewBuilder
    private func chipButton(_ c: InvoiceChip, count: Int) -> some View {
        if c == chip {
            Button { chip = c } label: { chipLabel(c, count: count) }
                .buttonStyle(.houseProminent)
        } else {
            Button { chip = c } label: { chipLabel(c, count: count) }
                .buttonStyle(.glass)
        }
    }

    private func chipLabel(_ c: InvoiceChip, count: Int) -> some View {
        HStack(spacing: 5) {
            Text(c.title)
            Text("\(count)").font(.caption).monospacedDigit().opacity(0.7)
        }
        .font(.subheadline.weight(.medium))
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

    /// Customer, phone, invoice id or a piece's SKU.
    private func matches(_ inv: Invoice, query q: String, digits: String, phones: [String: String]) -> Bool {
        if inv.id.localizedCaseInsensitiveContains(q) { return true }
        if inv.customerName.localizedCaseInsensitiveContains(q) { return true }
        if inv.items.contains(where: { $0.sku.localizedCaseInsensitiveContains(q) }) { return true }
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
        var info: [String: InvoiceCalendar.Bucket] = [:]
        var members: [String: [Invoice]] = [:]
        for inv in rows {
            let b: InvoiceCalendar.Bucket
            if let d = ERPDate.parse(inv.createdAt) {
                b = InvoiceCalendar.bucket(d, by: grouping, now: now)
            } else {
                b = InvoiceCalendar.Bucket(key: "undated", title: "No date", hint: "")
            }
            if info[b.key] == nil {
                info[b.key] = b
                order.append(b.key)
            }
            members[b.key, default: []].append(inv)
        }
        return order.map { key in
            let b = info[key]!
            return makeSection(id: key, title: b.title, hint: b.hint, danger: false, rows: members[key] ?? [])
        }
    }

    /// Awaiting payment (the oldest debt first: that is the one to chase), then Settled.
    private func statusSections(_ rows: [Invoice]) -> [InvoiceSection] {
        let owing = rows.filter { isOwing($0) }.sorted { $0.createdAt < $1.createdAt }
        let settled = rows.filter { !isOwing($0) }
        var out: [InvoiceSection] = []
        if !owing.isEmpty { out.append(makeSection(id: "owing", title: "Awaiting payment", hint: "oldest first", danger: true, rows: owing)) }
        if !settled.isEmpty { out.append(makeSection(id: "settled", title: "Settled", hint: "nothing outstanding", danger: false, rows: settled)) }
        return out
    }

    private func makeSection(id: String, title: String, hint: String, danger: Bool, rows: [Invoice]) -> InvoiceSection {
        var billed = 0.0
        var owed = 0.0
        for inv in rows {
            billed += inv.grandTotal
            if isOwing(inv) { owed += inv.balanceDue }
        }
        return InvoiceSection(id: id, title: title, hint: hint, danger: danger, rows: rows, billed: billed, owed: owed)
    }
}

/// A section's title, what it holds and what is still owed on it.
private struct InvoiceSectionHeader: View {
    let section: InvoiceSection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(section.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(section.danger ? Color.red : Color.primary)
                Text(detail).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                MoneyText(amount: section.billed)
                    .font(.subheadline.weight(.semibold))
                if section.owed > 0 {
                    Text("\(Money.pkr(section.owed)) owed")
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.red)
                }
            }
        }
        .textCase(nil)
        .foregroundStyle(.primary)
    }

    private var detail: String {
        let n = section.rows.count
        let count = "\(n) invoice\(n == 1 ? "" : "s")"
        return section.hint.isEmpty ? count : "\(section.hint) · \(count)"
    }
}

/// One invoice: who it was for and when, what it came to, and where its balance stands.
private struct InvoiceListRow: View {
    let invoice: Invoice

    var body: some View {
        NavigationLink(value: Route(path: InvoiceFacts.path(invoice.id))) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(InvoiceFacts.customerName(invoice))
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if isShopify {
                        StatusBadge("Shopify", color: .green)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 3) {
                    MoneyText(amount: invoice.grandTotal, exact: true)
                        .font(.subheadline.weight(.semibold))
                    balance
                }
            }
        }
    }

    private var isShopify: Bool { (invoice.source ?? "").hasPrefix("shopify") }

    private var subtitle: String {
        let when = ShopDate.say(invoice.createdAt)
        return when.isEmpty ? invoice.id : "\(invoice.id) · \(when)"
    }

    /// Owed in orange (red once it is old), credit green, a refunded sale named as such.
    @ViewBuilder
    private var balance: some View {
        let line = balanceLine(invoice.balanceDue)
        if invoice.status == .refunded {
            StatusBadge("Refunded", color: .purple)
        } else if line.state == .due {
            Text("\(Money.pkr(line.amount)) owed")
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(InvoiceFacts.tone(invoice))
        } else if line.state == .credit {
            Text("Credit \(Money.pkr(line.amount))")
                .font(.caption.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.green)
        } else {
            Text("Paid").font(.caption).foregroundStyle(.green)
        }
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
