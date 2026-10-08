import SwiftUI
import ERPCore

/// Money → Expenses (src/app/expenses/page.tsx): every expense in a period, grouped by day, week or
/// month with a subtotal for each group, with the page's tiles, a category filter and search. Adding
/// is native; Edit and Delete ask for the delete code, so they stay the ERP's page (a swipe on a row
/// opens it). The period and the grouping are two different questions, as on the web: how far back
/// to look, and how coarsely to bucket what is there.
struct ExpensesScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    @State private var search = ""
    @State private var period: ExpensePeriod = .thisMonth
    @State private var grouping: ExpenseGrouping = .day
    /// Custom range: from the first of this month to today until the person moves them.
    @State private var customFrom = Calendar.current.dateInterval(of: .month, for: Date())?.start ?? Date()
    @State private var useCustomTo = false
    @State private var customTo = Date()
    /// "" is every category.
    @State private var category = ""
    @State private var adding = false
    @State private var openWeb = false
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
            AddExpenseSheet(categories: sheetCategories, offersPartners: offersPartners) { (saved: ExpenseSavedNote) in
                withAnimation { note = saved }
            }
        }
        .navigationDestination(isPresented: $openWeb) {
            PlaceScreen(path: MoneyPaths.expensesWeb)
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
        let range = period.range(customFrom: customFromDay, customTo: customToDay, now: now)
        let scoped = scopedLines(range)
        let shown = category.isEmpty ? scoped : scoped.filter { $0.item.category == category }
        let groups = MoneyBuckets.group(shown, by: grouping, now: now, amount: { (e: Expense) -> Double in e.amount })
        let summary = ExpenseFigures.summary(shown, groups: groups)
        List {
            if period == .custom {
                Section {
                    customRange
                } header: {
                    Text("Custom range")
                } footer: {
                    Text("Without an end date it runs to the end of today.")
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
                    Label("Edit or delete an expense", systemImage: "safari")
                }
            } footer: {
                Text("Editing and deleting ask for the delete code, so they stay on the ERP's page.")
            }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .top, spacing: 0) { categoryChips(scoped) }
    }

    /// The custom range's days as the person picked them on the phone's calendar.
    private var customFromDay: String { MoneyCalendar.pickedDay(customFrom) }

    /// Nil leaves the end at today: `endOfDay(to || now)`.
    private var customToDay: String? { useCustomTo ? MoneyCalendar.pickedDay(customTo) : nil }

    /// "This month · 1 Oct – 8 Oct 2026".
    private func periodLine(_ range: MoneyDayRange) -> String {
        guard let caption = range.caption else { return period.title }
        return "\(period.title) · \(caption)"
    }

    private var customRange: some View {
        let upper = max(Date(), customFrom)
        return Group {
            DatePicker("From", selection: $customFrom, in: ...Date(), displayedComponents: .date)
                .onChange(of: customFrom) { _, picked in
                    if customTo < picked { customTo = picked }
                }
            Toggle("End on a date", isOn: $useCustomTo)
            if useCustomTo {
                DatePicker("To", selection: $customTo, in: customFrom...upper, displayedComponents: .date)
            }
        }
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
            HStack(alignment: .top, spacing: 10) {
                FigureTile(label: "Total expenses", value: Money.pkr(s.total), tint: Theme.accent)
                FigureTile(label: "Payments", value: "\(s.count)", detail: category.isEmpty ? nil : category)
            }
            HStack(alignment: .top, spacing: 10) {
                FigureTile(label: "Average per \(per)", value: Money.pkr(s.perBucket))
                FigureTile(label: "Karigar payments", value: Money.pkr(s.karigarTotal), detail: "\(s.karigarShare)% of total")
            }
            FigureTile(label: "Biggest \(per)", value: Money.pkr(s.biggestTotal), detail: s.biggestLabel)
        }
        .padding(.vertical, 4)
    }

    private func groupHeader(_ group: MoneyGroup<Expense>) -> some View {
        let n = group.rows.count
        let count = "\(n) item\(n == 1 ? "" : "s")"
        let detail = group.sub.isEmpty ? count : "\(group.sub) · \(count)"
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(group.label).font(.subheadline.weight(.semibold))
                Text(detail).font(.caption2).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            MoneyText(amount: group.total, exact: true)
                .font(.subheadline.weight(.semibold))
        }
        .textCase(nil)
        .foregroundStyle(.primary)
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
            Button { openWeb = true } label: { Label("Edit or delete", systemImage: "pencil") }
                .tint(.blue)
        }
        .contextMenu {
            Button { openWeb = true } label: { Label("Edit or delete on the ERP's page", systemImage: "safari") }
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
        if let partner = partnerName(e.shareholderId) { parts.append(partner) }
        if let payer = payerName(e.paidBy) { parts.append("paid by \(payer)") }
        return parts.joined(separator: " · ")
    }

    /// The partner a salary row paid (lib/shareholders.ts SHAREHOLDERS).
    private func partnerName(_ id: String?) -> String? {
        switch id ?? "" {
        case "mina": return "Mina"
        case "ammar": return "Ammar"
        default: return nil
        }
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

    /// Every category an expense carries, the most used first. The web lists the house's own list (a
    /// build setting, NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES) and then any other name an expense carries,
    /// sorted; the app cannot read that list, so it offers what the books use.
    private var usedCategories: [String] { ExpenseFigures.categoriesByUse(book.expenses.items) }

    /// What the Add expense sheet offers: the same, then "Other" (always last in the web's list).
    private var sheetCategories: [String] {
        var out = usedCategories.filter { $0 != "Other" }
        out.append("Other")
        return out
    }

    /// The web offers "Paid by" the partners only in the house that keeps partner ledgers
    /// (NEXT_PUBLIC_STORE_PARTNERSHIP: House of Mina); a house whose books already carry one has it too.
    private var offersPartners: Bool {
        if House.id == "mina" { return true }
        return book.expenses.items.contains { e in
            switch e.paidBy {
            case .ammar, .mina: return true
            default: return false
            }
        }
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

    @ViewBuilder
    private func chip(_ title: String, count: Int, selected: Bool, action: @escaping () -> Void) -> some View {
        if selected {
            Button(action: action) { chipLabel(title, count: count) }
                .buttonStyle(.glassProminent)
        } else {
            Button(action: action) { chipLabel(title, count: count) }
                .buttonStyle(.glass)
        }
    }

    private func chipLabel(_ title: String, count: Int) -> some View {
        HStack(spacing: 5) {
            Text(title)
            Text("\(count)").font(.caption).monospacedDigit().opacity(0.7)
        }
        .font(.subheadline.weight(.medium))
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
