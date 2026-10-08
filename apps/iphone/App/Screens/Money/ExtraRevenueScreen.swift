import SwiftUI
import ERPCore

/// Money → Extra revenue (src/app/additional-revenue/page.tsx): income not tied to an order or
/// invoice, month by month with each month's total. Read only: adding, editing and deleting ask
/// for the delete code or a form the phone does not have yet, so they are the ERP's page. Money
/// taken on a repair ticket opens that ticket, as the web's "Change this on the repair" does.
struct ExtraRevenueScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var search = ""
    @State private var openWeb = false

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
                NavigationLink(value: Route(path: MoneyPaths.revenueWeb)) {
                    Label("Add extra revenue", systemImage: "plus")
                }
            }
        }
        .navigationDestination(isPresented: $openWeb) {
            PlaceScreen(path: MoneyPaths.revenueWeb)
        }
        .task { book.revenue.need() }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let shown = lines()
        let months = MoneyMonths.group(shown, amount: { (r: AdditionalRevenue) -> Double in r.amount })
        List {
            Section {
                figures(shown)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text("Income not tied to an order or invoice.").textCase(nil)
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
        }
        .listStyle(.insetGrouped)
    }

    private func lines() -> [MoneyLine<AdditionalRevenue>] {
        let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
        var out: [MoneyLine<AdditionalRevenue>] = []
        for r in book.revenue.items {
            if !needle.isEmpty && !r.description.localizedCaseInsensitiveContains(needle) { continue }
            out.append(MoneyLine(item: r, day: MoneyMonths.day(r.date)))
        }
        return out
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "No revenue entries found",
            systemImage: "chart.line.uptrend.xyaxis",
            description: Text(search.isEmpty ? "Add a revenue entry to begin." : "Try adjusting your search.")
        )
    }

    private func figures(_ shown: [MoneyLine<AdditionalRevenue>]) -> some View {
        var total = 0.0
        for line in shown { total += line.item.amount }
        let count = shown.count
        return HStack(alignment: .top, spacing: 10) {
            FigureTile(label: "Total revenue", value: Money.pkr(total), tint: Theme.accent)
            FigureTile(label: "Entries", value: "\(count)")
        }
        .padding(.vertical, 4)
    }

    private func monthHeader(_ month: MoneyMonth<AdditionalRevenue>) -> some View {
        let n = month.rows.count
        let count = "\(n) entr\(n == 1 ? "y" : "ies")"
        let detail = month.hint.isEmpty ? count : "\(month.hint) · \(count)"
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(month.title).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            MoneyText(amount: month.total, exact: true)
                .font(.subheadline.weight(.semibold))
        }
        .textCase(nil)
        .foregroundStyle(.primary)
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
                    subtitle: when.isEmpty ? "Change this on the repair" : "\(when) · Change this on the repair",
                    trailing: Money.pkr(r.amount)
                )
            }
        } else {
            TwoLine(title: r.description, subtitle: when, trailing: Money.pkr(r.amount))
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button { openWeb = true } label: { Label("Edit or delete", systemImage: "pencil") }
                        .tint(.blue)
                }
                .contextMenu {
                    Button { openWeb = true } label: { Label("Edit or delete on the ERP's page", systemImage: "safari") }
                }
        }
    }
}
