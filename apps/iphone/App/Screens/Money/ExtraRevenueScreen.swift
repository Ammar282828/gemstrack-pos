import SwiftUI
import ERPCore

/// Money → Extra revenue (src/app/additional-revenue/page.tsx): income not tied to an order or
/// invoice, month by month with each month's total. Adding, editing and deleting are native (the
/// page's form; a swipe or a long press on a row), and Delete asks for the delete code, which the ERP
/// checks with the delete itself. Money taken on a repair ticket opens that ticket instead, as the
/// web's "Change this on the repair" does: it changes there, and goes when the ticket is deleted.
struct ExtraRevenueScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var search = ""
    /// The date filter, none until a start date is chosen (additional-revenue/page.tsx `dateRange`).
    @State private var dates = MoneyCustomRange()
    @State private var adding = false
    @State private var editing: AdditionalRevenue?
    @State private var deletion: OwnerDeletion?
    @State private var note: OwnerNote?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if session.isOwner {
            owners
        } else {
            MoneyOwnersOnly(title: "Extra revenue")
        }
    }

    private var owners: some View {
        ShelfState(loaded: book.revenue.loaded, error: book.revenue.error, offline: book.revenue.offline) {
            content
        }
        .navigationTitle("Extra revenue")
        .searchable(text: $search, prompt: "Search by description")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("Add extra revenue", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $adding) {
            RevenueEditSheet(editing: nil) { (saved: OwnerNote) in Note.show(saved, in: $note, reduce: reduceMotion) }
        }
        .sheet(item: $editing) { (r: AdditionalRevenue) in
            RevenueEditSheet(editing: r) { (saved: OwnerNote) in Note.show(saved, in: $note, reduce: reduceMotion) }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(Note(title: "Deleted", detail: "Revenue entry deleted."), in: $note, reduce: reduceMotion)
            }
        }
        .noteToast($note)
        .task { book.revenue.need() }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let shown = lines()
        let months = MoneyMonths.group(shown, amount: { (r: AdditionalRevenue) -> Double in r.amount })
        List { Group {
            Section {
                MoneyRangeFields(filter: $dates)
            } header: {
                LedgerHeading(title: "Dates")
            } footer: {
                Text(dates.useFrom ? "Without an end date it runs to the end of today." : "Until a start date is chosen, every entry is shown.")
            }
            Section {
                figures(shown)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            if months.isEmpty {
                Section { emptyState }
            } else {
                ForEach(months) { month in
                    Section {
                        ForEach(month.rows) { line in row(line) }
                    } header: {
                        monthHeader(month)
                    }
                }
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
    }

    /// The dates, then the search over descriptions. The web's range ends at midnight of the last day
    /// it names (`end: dateRange.to ?? new Date()`), which drops that day's later entries (a repair's
    /// money, taken at its own time); here the last day counts to its end, as on Expenses.
    private func lines() -> [MoneyLine<AdditionalRevenue>] {
        let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = dates.range()
        var out: [MoneyLine<AdditionalRevenue>] = []
        for r in book.revenue.items {
            let day = MoneyMonths.day(r.date)
            if !range.contains(day) { continue }
            if !needle.isEmpty && !r.description.localizedCaseInsensitiveContains(needle) { continue }
            out.append(MoneyLine(item: r, day: day))
        }
        return out
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "No revenue entries found",
            systemImage: "chart.line.uptrend.xyaxis",
            description: Text(search.isEmpty && !dates.useFrom ? "Add a revenue entry to begin." : "Try adjusting your search or filters.")
        )
    }

    private func figures(_ shown: [MoneyLine<AdditionalRevenue>]) -> some View {
        var total = 0.0
        for line in shown { total += line.item.amount }
        let count = shown.count
        // One hero, the total, with how many entries under it (rule 15).
        return VStack(alignment: .leading, spacing: 6) {
            Text("Total revenue").font(.subheadline).foregroundStyle(.secondary)
            HeroAmount(amount: total)
            Text("\(count) entr\(count == 1 ? "y" : "ies")").font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .heroSheen()
        .padding(.vertical, 4)
    }

    /// The month and what it came to: one trailing figure, no second line (rule 15).
    private func monthHeader(_ month: MoneyMonth<AdditionalRevenue>) -> some View {
        LedgerHeading(title: month.title, trailing: Money.pkr(month.total))
    }

    // MARK: Rows

    @ViewBuilder
    private func row(_ line: MoneyLine<AdditionalRevenue>) -> some View {
        let r = line.item
        let when = ShopDate.say(r.date)
        if let repairId = r.repairId, !repairId.isEmpty {
            // A repair's money is changed on the repair, never deleted as a loose row.
            NavigationLink(value: Route(path: MoneyPaths.repair(repairId))) {
                TwoLine(
                    title: r.description,
                    subtitle: when.isEmpty ? "Repair" : "\(when) · Repair",
                    trailing: Money.pkr(r.amount)
                )
                .lineLimit(1)
            }
        } else {
            TwoLine(title: r.description, subtitle: when, trailing: Money.pkr(r.amount))
                .lineLimit(1)
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) { askDelete(r) } label: { Label("Delete", systemImage: "trash") }
                    Button { editing = r } label: { Label("Edit", systemImage: "pencil") }
                        .tint(Theme.accent)
                }
                .contextMenu {
                    Button { editing = r } label: { Label("Edit", systemImage: "pencil") }
                    Button(role: .destructive) { askDelete(r) } label: { Label("Delete", systemImage: "trash") }
                }
        }
    }

    /// The web's "Delete revenue entry?" and the code, in one sheet; the ERP checks the code with the
    /// delete (`deleteExtraRevenue`), in the store's own words for it.
    private func askDelete(_ r: AdditionalRevenue) {
        let id = r.id
        deletion = OwnerDeletion(
            what: "Delete this extra revenue",
            detail: "This will permanently delete \u{201C}\(r.description)\u{201D} (\(Money.pkr(r.amount)))."
        ) { code in
            _ = try await ERPAPI.shared.write("deleteExtraRevenue", ["revenueId": id, "deleteCode": code])
        }
    }
}
