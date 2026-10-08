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
    @State private var paying: Invoice?

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
            Section { subtitle(all) }
            if groups.isEmpty {
                Section { emptyState }
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
        let filtering = !search.isEmpty || !takenBy.isEmpty || !month.isEmpty || chip != .all
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
                .buttonStyle(.glassProminent)
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
        let filtering = !takenBy.isEmpty || !month.isEmpty
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
        } label: {
            Label("Filter", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    // MARK: Filtering and grouping

    /// Search, Taken by and Month: everything but the chip, so the chips can count what they would show.
    private func scope(_ all: [Invoice]) -> [Invoice] {
        var out = all
        if !takenBy.isEmpty { out = out.filter { $0.takenBy == takenBy } }
        if !month.isEmpty { out = out.filter { InvoiceCalendar.monthKey($0.createdAt) == month } }
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
