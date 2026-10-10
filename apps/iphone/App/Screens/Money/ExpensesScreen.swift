import SwiftUI
import ERPCore

/// Money → Expenses (src/app/expenses/page.tsx): every expense in a period, grouped by day, week or
/// month with a subtotal for each group, with the page's tiles, a category filter and search. Adding,
/// editing and deleting are native (a swipe or a long press on a row): Delete asks for the delete code,
/// which the ERP checks with the delete itself. A partner's drawing is the Shareholders page's, where it
/// goes with its withdrawal, so its row points there instead. The report PDF is drawn by the ERP's page.
/// The period and the grouping are two different questions, as on the web: how far back to look, and
/// how coarsely to bucket what is there.
struct ExpensesScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var search = ""
    @State private var period: ExpensePeriod = .thisMonth
    @State private var grouping: ExpenseGrouping = .day
    /// Custom range: no bound until a start date is chosen (date-grouping.ts periodRange).
    @State private var custom = MoneyCustomRange()
    /// "" is every category.
    @State private var category = ""
    @State private var adding = false
    @State private var editing: Expense?
    @State private var deletion: OwnerDeletion?
    @State private var openWeb = false
    @State private var openShareholders = false
    @State private var note: ExpenseSavedNote?

    var body: some View {
        if session.isOwner {
            owners
        } else {
            MoneyOwnersOnly(title: "Expenses")
        }
    }

    private var owners: some View {
        ShelfState(loaded: book.expenses.loaded, error: book.expenses.error, offline: book.expenses.offline) {
            content
        }
        .navigationTitle("Expenses")
        .searchable(text: $search, prompt: "Description, category or karigar")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { filterMenu }
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("Add expense", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $adding) {
            AddExpenseSheet(categories: sheetCategories, partnership: session.shop.partnership) { (saved: ExpenseSavedNote) in
                withAnimation { note = saved }
            }
        }
        .sheet(item: $editing) { (e: Expense) in
            ExpenseEditSheet(expense: e, categories: sheetCategories, partnership: session.shop.partnership) { (saved: ExpenseSavedNote) in
                withAnimation { note = saved }
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                withAnimation { note = ExpenseSavedNote(title: "Expense deleted", detail: "The record has been removed.") }
            }
        }
        .navigationDestination(isPresented: $openWeb) {
            PlaceScreen(path: MoneyPaths.expensesWeb)
        }
        .navigationDestination(isPresented: $openShareholders) {
            PlaceScreen(path: MoneyPaths.shareholders)
        }
        .overlay(alignment: .bottom) {
            if let note {
                ExpenseSavedBanner(note: note)
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        // Said for a few seconds, like the web's toast, then gone.
        .task(id: note) {
            guard note != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { withAnimation { note = nil } }
        }
        .task {
            book.expenses.need()
            book.karigars.need()
            book.karigarBatches.need()
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let now = Date()
        let range = period.range(customFrom: custom.fromDay, customTo: custom.toDay, now: now)
        let scoped = scopedLines(range)
        let shown = category.isEmpty ? scoped : scoped.filter { $0.item.category == category }
        let groups = MoneyBuckets.group(shown, by: grouping, now: now, amount: { (e: Expense) -> Double in e.amount })
        let summary = ExpenseFigures.summary(shown, groups: groups)
        List { Group {
            if period == .custom {
                Section {
                    MoneyRangeFields(filter: $custom)
                } header: {
                    LedgerHeading(title: "Custom range")
                } footer: {
                    Text(custom.useFrom ? "Without an end date it runs to the end of today." : "Until a start date is chosen, every expense is shown.")
                }
            }
            Section {
                figures(summary)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text(periodLine(range)).textCase(nil)
            }
            if groups.isEmpty {
                Section { emptyState }
            } else {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.rows) { line in row(line) }
                    } header: {
                        groupHeader(group)
                    }
                }
            }
            Section {
                Button { openWeb = true } label: {
                    Label("Expense report (PDF)", systemImage: "doc.richtext")
                }
            } footer: {
                Text("The report is drawn by the ERP's page, for the period and filters chosen there.")
            }
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .safeAreaBar(edge: .top, spacing: 0) { categoryChips(scoped) }
    }

    /// "This month · 1 Oct – 8 Oct 2026".
    private func periodLine(_ range: MoneyDayRange) -> String {
        guard let caption = range.caption else { return period.title }
        return "\(period.title) · \(caption)"
    }

    /// Search and the period: everything but the category, so each chip can count what it would show.
    private func scopedLines(_ range: MoneyDayRange) -> [MoneyLine<Expense>] {
        let needle = search.trimmingCharacters(in: .whitespacesAndNewlines)
        var out: [MoneyLine<Expense>] = []
        for e in book.expenses.items {
            let day = MoneyMonths.day(e.date)
            if !range.contains(day) { continue }
            if !needle.isEmpty && !matches(e, needle) { continue }
            out.append(MoneyLine(item: e, day: day))
        }
        return out
    }

    /// Description, category or the karigar paid.
    private func matches(_ e: Expense, _ q: String) -> Bool {
        if e.description.localizedCaseInsensitiveContains(q) { return true }
        if e.category.localizedCaseInsensitiveContains(q) { return true }
        if let kid = e.karigarId, let name = book.karigars.item(kid)?.name, name.localizedCaseInsensitiveContains(q) { return true }
        return false
    }

    private var emptyState: some View {
        let filtering = !search.isEmpty || !category.isEmpty
        let text = filtering ? "Select a wider period, or clear the filters." : "No expenses recorded for \(period.title.lowercased())."
        return ContentUnavailableView("No expenses in this period", systemImage: "creditcard", description: Text(text))
    }

    // MARK: Figures

    /// The page's tiles in its order: total, payments, average per day/week/month, karigar payments;
    /// then the biggest day/week/month, which the page works out (`summary.biggest`) but leaves unshown.
    private func figures(_ s: ExpenseSummary) -> some View {
        let per = grouping.title.lowercased()
        return VStack(spacing: 10) {
            FigureRow(alignment: .top, spacing: 10) {
                FigureTile(label: "Total expenses", value: Money.pkr(s.total), tint: Theme.accent)
                FigureTile(label: "Payments", value: "\(s.count)", detail: category.isEmpty ? nil : category)
            }
            DisclosureGroup("Spending breakdown") {
                VStack(spacing: 12) {
                    TwoLine(title: "Average per \(per)", trailing: Money.pkr(s.perBucket))
                    TwoLine(title: "Karigar payments", subtitle: "\(s.karigarShare)% of total", trailing: Money.pkr(s.karigarTotal))
                    TwoLine(title: "Biggest \(per)", subtitle: s.biggestLabel, trailing: Money.pkr(s.biggestTotal))
                }
                .padding(.top, 12)
            }
            .font(.subheadline)
            .ledgerCard()
        }
        .padding(.vertical, 4)
    }

    private func groupHeader(_ group: MoneyGroup<Expense>) -> some View {
        let n = group.rows.count
        let count = "\(n) item\(n == 1 ? "" : "s")"
        let detail = group.sub.isEmpty ? count : "\(group.sub) · \(count)"
        return VStack(alignment: .leading, spacing: 6) {
            LedgerHeading(title: group.label, trailing: Money.pkr(group.total))
            Text(detail).font(.footnote).foregroundStyle(.secondary)
        }
    }

    // MARK: Rows

    private func row(_ line: MoneyLine<Expense>) -> some View {
        let e = line.item
        return TwoLine(
            title: e.description.isEmpty ? e.category : e.description,
            subtitle: subtitle(e),
            trailing: Money.pkr(e.amount)
        )
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if ExpenseEditing.isDrawing(e, partnership: session.shop.partnership) {
                Button { openShareholders = true } label: { Label("Shareholders", systemImage: "person.2") }
                    .tint(.indigo)
            } else {
                Button(role: .destructive) { askDelete(e) } label: { Label("Delete", systemImage: "trash") }
                Button { editing = e } label: { Label("Edit", systemImage: "pencil") }
                    .tint(.blue)
            }
        }
        .contextMenu {
            if ExpenseEditing.isDrawing(e, partnership: session.shop.partnership) {
                Button { openShareholders = true } label: { Label("Change this on Shareholders", systemImage: "person.2") }
            } else {
                Button { editing = e } label: { Label("Edit", systemImage: "pencil") }
                Button(role: .destructive) { askDelete(e) } label: { Label("Delete", systemImage: "trash") }
            }
        }
    }

    /// The web's "Delete this expense?" and the code, in one sheet: what goes is said before the code is
    /// asked for. The ERP checks the code with the delete (`deleteExpense`).
    private func askDelete(_ e: Expense) {
        let id = e.id
        deletion = OwnerDeletion(what: ExpenseEditing.deleteWhat(e), detail: "Delete this expense? \(ExpenseEditing.deleteDetail(e))") { code in
            _ = try await ERPAPI.shared.write("deleteExpense", ["expenseId": id, "deleteCode": code])
        }
    }

    /// When, which category, and who it went to: the karigar or partner it paid, and a partner who
    /// fronted the cash (the web's badges).
    private func subtitle(_ e: Expense) -> String {
        var parts: [String] = []
        let when = ShopDate.say(e.date)
        if !when.isEmpty { parts.append(when) }
        if !e.category.isEmpty { parts.append(e.category) }
        if let kid = e.karigarId, let name = book.karigars.item(kid)?.name, !name.isEmpty { parts.append(name) }
        if let partner = MoneyPartners.name(e.shareholderId) { parts.append(partner) }
        if let payer = payerName(e.paidBy) { parts.append("paid by \(payer)") }
        return parts.joined(separator: " · ")
    }

    /// Nil for the business: an expense with no `paidBy` is the business's.
    private func payerName(_ who: PaidBy) -> String? {
        switch who {
        case .business: return nil
        case .ammar: return "Ammar"
        case .mina: return "Mina"
        case .unknown(let raw): return raw.isEmpty ? nil : raw.capitalized
        }
    }

    // MARK: Categories

    /// The filter's list, as the web builds it: the house's own list (the ERP says it), then any other
    /// name an expense carries, sorted. With no house list (the demo, an old cached answer) it offers
    /// what the books use, the most used first.
    private var usedCategories: [String] {
        ExpenseFigures.categories(shop: session.shop.expenseCategories, expenses: book.expenses.items)
    }

    /// What the Add expense sheet offers.
    private var sheetCategories: [String] {
        ExpenseFigures.formCategories(shop: session.shop.expenseCategories, expenses: book.expenses.items)
    }

    @ViewBuilder
    private func categoryChips(_ scoped: [MoneyLine<Expense>]) -> some View {
        let names = usedCategories
        if !names.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("All", count: scoped.count, selected: category.isEmpty) { category = "" }
                    ForEach(names, id: \.self) { (name: String) in
                        chip(name, count: scoped.filter { $0.item.category == name }.count, selected: category == name) {
                            category = name
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.vertical, 6)
            }
        }
    }

    private func chip(_ title: String, count: Int, selected: Bool, action: @escaping () -> Void) -> some View {
        FilterChip(title: title, count: count, chosen: selected, action: action)
    }

    // MARK: Period and grouping

    private var filterMenu: some View {
        let filtering = period != .thisMonth || grouping != .day
        return Menu {
            Picker("Period", selection: $period) {
                ForEach(ExpensePeriod.allCases) { (p: ExpensePeriod) in Text(p.title).tag(p) }
            }
            Picker("Group by", selection: $grouping) {
                ForEach(ExpenseGrouping.allCases) { (g: ExpenseGrouping) in Text(g.title).tag(g) }
            }
        } label: {
            Label("Period and grouping", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }
}
