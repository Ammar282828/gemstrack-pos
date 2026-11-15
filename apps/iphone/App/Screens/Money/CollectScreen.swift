import SwiftUI
import ERPCore

/// Sales → To collect (src/app/collect/page.tsx, docs/decisions.md "To collect"): everyone who still owes the shop, one row per
/// bill, never the hisaab's own entries. An invoice not refunded with a balance, or an order marked Completed and not yet
/// invoiced with a balance (ERPCore `collectRows`, the web's lib/collect.ts). Grouped under Taken by (or one list sorted Oldest
/// / Largest), with the person the main filter, several at once, and bill, age and paid narrowing it. Owners only: what
/// customers owe is the books. A row opens its invoice or order; the Contact menu is on a press and hold.
struct CollectScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var sort: CollectSort = .takenBy
    @State private var filters = COLLECT_NO_FILTERS

    var body: some View {
        if session.isOwner {
            owners
        } else {
            MoneyOwnersOnly(title: "To collect")
        }
    }

    private var ready: Bool { book.invoices.loaded && book.orders.loaded }

    private var owners: some View {
        ShelfState(loaded: ready, error: book.invoices.error ?? book.orders.error,
                   offline: book.invoices.offline || book.orders.offline, shape: .list) {
            content
        }
        .navigationTitle("To collect")
        .hubTitleDisplay()
        .task {
            book.invoices.need()
            book.orders.need()
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let now = Date()
        let all = collectRows(book.invoices.items, book.orders.items)
        // Every person with anything owing, in the order of what they are owed, so the chips never jump as filters change.
        let people = byTakenBy(all)
        let shown = sortRows(filterRows(all, filters, now: now), by: sort)
        let total = all.reduce(0.0) { (sum: Double, r: CollectRow) -> Double in sum + r.due }
        let shownTotal = shown.reduce(0.0) { (sum: Double, r: CollectRow) -> Double in sum + r.due }
        let perPerson = countBy(all, filters, group: .people, valueOf: { (r: CollectRow) -> String in r.takenBy }, now: now)
        let perKind = countBy(all, filters, group: .kinds, valueOf: { (r: CollectRow) -> CollectKind in r.kind }, now: now)
        let perAge = countBy(all, filters, group: .ages, valueOf: { (r: CollectRow) -> CollectAge in ageOf(r, now: now) }, now: now)
        let perPaid = countBy(all, filters, group: .paid, valueOf: { (r: CollectRow) -> CollectPaid in paidOf(r) }, now: now)
        let groups = groupRows(shown, people: people)
        List { Group {
            if !all.isEmpty {
                Section {
                    figure(total: total, count: all.count, shown: shown.count, shownTotal: shownTotal)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                Section {
                    Picker("Sort by", selection: $sort) {
                        ForEach(CollectSort.allCases, id: \.self) { (s: CollectSort) in Text(Self.sortTitle(s)).tag(s) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }
                // The main filter: who took it. Several may be chosen; Everyone clears them.
                Section {
                    peopleChips(people, perPerson)
                        .chipRowInList()
                } header: {
                    Text("Taken by")
                }
                // Then narrow it: the bill, how long it has waited, whether anything was paid.
                Section {
                    narrowChips(perKind, perAge, perPaid)
                        .chipRowInList()
                }
            }
            ForEach(groups) { (g: CollectGroupRows) in
                Section {
                    ForEach(g.rows, id: \.rowID) { (r: CollectRow) in row(r, now: now) }
                } header: {
                    LedgerHeading(title: g.title, count: g.rows.count,
                                  trailing: Money.lacCrore(g.rows.reduce(0.0) { (sum: Double, r: CollectRow) -> Double in sum + r.due }))
                }
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .pullDownSearch(text: $filters.query, prompt: "Customer, number or bill")
        .motion(filters, Motion.travel)
        .motion(sort, Motion.travel)
        .overlay {
            if all.isEmpty {
                EmptyState("Nobody owes anything", symbol: "banknote", message: "Every invoice and completed order is paid.")
            } else if shown.isEmpty {
                EmptyState("Nothing matches", symbol: "banknote", message: "No bill passes all of these filters.",
                           action: (title: "Clear filters", run: { filters = COLLECT_NO_FILTERS }))
            }
        }
    }

    // MARK: Figure

    private func figure(total: Double, count: Int, shown: Int, shownTotal: Double) -> some View {
        let on = filtersOn(filters)
        return VStack(alignment: .leading, spacing: pt(8)) {
            FigureTile(label: "To collect", value: Money.pkrLac(on > 0 ? shownTotal : total),
                       detail: on > 0 ? "\(shown) of \(count) bills" : "\(count) bill\(count == 1 ? "" : "s")",
                       tint: Tone.owed.color)
            if on > 0 {
                Button("Clear filters") { filters = COLLECT_NO_FILTERS }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, pt(4))
    }

    // MARK: Chips

    private func peopleChips(_ people: [CollectPerson], _ per: [String: CollectCount]) -> some View {
        ChipRow {
            FilterChip(title: "Everyone", chosen: filters.people.isEmpty) { filters.people = [] }
            ForEach(people, id: \.takenBy) { (p: CollectPerson) in
                let c = per[p.takenBy]
                FilterChip(title: "\(Self.who(p.takenBy)) · \(Money.lacCrore(c?.due ?? 0))", count: c?.count ?? 0,
                           chosen: filters.people.contains(p.takenBy)) {
                    if filters.people.contains(p.takenBy) { filters.people.remove(p.takenBy) } else { filters.people.insert(p.takenBy) }
                }
                // A chip at 0 says choosing it would empty the list.
                .opacity(filters.people.contains(p.takenBy) || c != nil ? 1 : 0.5)
            }
        }
    }

    private func narrowChips(_ kinds: [CollectKind: CollectCount], _ ages: [CollectAge: CollectCount],
                             _ paids: [CollectPaid: CollectCount]) -> some View {
        ChipRow {
            ForEach(CollectKind.allCases, id: \.self) { (k: CollectKind) in
                FilterChip(title: Self.kindTitle(k), count: kinds[k]?.count ?? 0, chosen: filters.kinds.contains(k)) {
                    if filters.kinds.contains(k) { filters.kinds.remove(k) } else { filters.kinds.insert(k) }
                }
            }
            ForEach(CollectAge.allCases, id: \.self) { (a: CollectAge) in
                FilterChip(title: Self.ageTitle(a), count: ages[a]?.count ?? 0, chosen: filters.ages.contains(a)) {
                    if filters.ages.contains(a) { filters.ages.remove(a) } else { filters.ages.insert(a) }
                }
            }
            ForEach(CollectPaid.allCases, id: \.self) { (p: CollectPaid) in
                FilterChip(title: Self.paidTitle(p), count: paids[p]?.count ?? 0, chosen: filters.paid.contains(p)) {
                    if filters.paid.contains(p) { filters.paid.remove(p) } else { filters.paid.insert(p) }
                }
            }
        }
    }

    // MARK: Rows

    private func row(_ r: CollectRow, now: Date) -> some View {
        NavigationLink(value: Route(path: r.href)) {
            CollectRowView(row: r, now: now)
        }
        .contextMenu {
            CustomerContactMenu(phone: r.phone, customerId: r.customerId, customerName: r.customerName)
        }
    }

    // MARK: Grouping and words

    /// Under each person's name when sorted by who took it; one list otherwise.
    private func groupRows(_ shown: [CollectRow], people: [CollectPerson]) -> [CollectGroupRows] {
        if shown.isEmpty { return [] }
        if sort != .takenBy {
            let on = filtersOn(filters) > 0
            let title = filters.people.count == 1 ? Self.who(filters.people.first ?? "") : (on ? "Filtered" : "Everyone")
            return [CollectGroupRows(id: "all", title: title, rows: shown)]
        }
        var byPerson: [String: [CollectRow]] = [:]
        for r in shown { byPerson[r.takenBy, default: []].append(r) }
        return people.compactMap { (p: CollectPerson) -> CollectGroupRows? in
            guard let rows = byPerson[p.takenBy] else { return nil }
            return CollectGroupRows(id: p.takenBy.isEmpty ? "nobody" : p.takenBy, title: Self.who(p.takenBy), rows: rows)
        }
    }

    static func who(_ takenBy: String) -> String { takenBy.isEmpty ? "Not recorded" : takenBy }

    static func sortTitle(_ s: CollectSort) -> String {
        switch s {
        case .takenBy: return "Taken by"
        case .oldest: return "Oldest"
        case .amount: return "Largest"
        }
    }

    static func kindTitle(_ k: CollectKind) -> String { k == .invoice ? "Invoices" : "Completed orders" }

    static func ageTitle(_ a: CollectAge) -> String {
        switch a {
        case .under30: return "Under 30 days"
        case .thirtyTo90: return "30\u{2013}90 days"
        case .over90: return "Over 90 days"
        }
    }

    static func paidTitle(_ p: CollectPaid) -> String { p == .nothing ? "Nothing paid" : "Part paid" }
}

private struct CollectGroupRows: Identifiable {
    let id: String
    let title: String
    let rows: [CollectRow]
}

/// One bill: who owes, which bill and when, how long it has waited and who took it; what is due, red past 30 days.
private struct CollectRowView: View {
    let row: CollectRow
    let now: Date
    @Environment(\.dynamicTypeSize) private var typeSize

    private static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = ERPDate.karachi
        f.dateFormat = "d MMM yyyy"
        return f
    }()

    /// Whole calendar days since the bill (date-fns differenceInCalendarDays); 0 for a date that cannot be read.
    private var days: Int {
        guard let d = ERPDate.parse(row.date) else { return 0 }
        let cal = ERPDate.karachiCalendar
        return cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: now)).day ?? 0
    }

    private var facts: String {
        var parts: [String] = ["\(row.kind == .invoice ? "Invoice" : "Order") \(row.id)"]
        if let d = ERPDate.parse(row.date) { parts.append(Self.dayFormat.string(from: d)) }
        if days > 0 { parts.append("\(days) day\(days == 1 ? "" : "s")") }
        parts.append(CollectScreen.who(row.takenBy))
        return parts.joined(separator: " \u{00B7} ")
    }

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: pt(8)))
            : AnyLayout(HStackLayout(alignment: .center, spacing: pt(12)))
        layout {
            if !typeSize.isAccessibilitySize { Monogram(name: row.customerName, size: Monogram.Size.row) }
            VStack(alignment: .leading, spacing: pt(2)) {
                Text(row.customerName).font(.house(.headline)).lineLimit(2)
                Text(facts).font(.house(.caption)).foregroundStyle(.secondary).lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: typeSize.isAccessibilitySize ? .leading : .trailing, spacing: pt(4)) {
                MoneyText(amount: row.due).font(.house(.subheadline).weight(.semibold))
                Pill(row.due >= row.total ? "Unpaid" : "of \(Money.pkrLac(row.total))", tone: days > 30 ? .late : .owed)
            }
        }
        .padding(.vertical, pt(2))
        .accessibilityElement(children: .combine)
    }
}
