import SwiftUI
import ERPCore

/// Money → Expenses (src/app/expenses/page.tsx): every expense in a period, grouped by day, week or
/// month with a subtotal for each group, with the page's tiles, a category filter and search. Adding,
/// editing and deleting are native (a swipe or a long press on a row): Delete asks for the delete code,
/// which the ERP checks with the delete itself. A partner's drawing is the Shareholders page's, where it
/// goes with its withdrawal, so its row points there instead. The report PDF is the page's own (Report), drawn by
/// the ERP's server for the filters on screen (src/lib/expense-report-pdf.ts, /api/app/pdf/expenses).
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
    @State private var report: InvoicePDFTarget?
    @State private var openShareholders = false
    @State private var note: ExpenseSavedNote?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(macOS)
    @State private var macSort = [KeyPathComparator(\ExpensesMacRow.day, order: .reverse)]
    @State private var macPick = Set<String>()
    #endif

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
        .hubTitleDisplay()
        .searchable(text: $search, prompt: "Description, category or karigar")
        .toolbar {
            #if !os(macOS)
            ToolbarItem(placement: .topBarTrailing) { filterMenu }
            #endif
            ToolbarItem(placement: .primaryAction) {
                Button { adding = true } label: { Label("Add expense", systemImage: "plus") }
                #if os(macOS)
                    .keyboardShortcut("e", modifiers: [.command, .shift])
                    .help("Add an expense (\u{21E7}\u{2318}E)")
                #endif
            }
        }
        .sheet(isPresented: $adding) {
            AddExpenseSheet(categories: sheetCategories, partnership: session.shop.partnership) { (saved: ExpenseSavedNote) in
                Note.show(saved, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $editing) { (e: Expense) in
            ExpenseEditSheet(expense: e, categories: sheetCategories, partnership: session.shop.partnership) { (saved: ExpenseSavedNote) in
                Note.show(saved, in: $note, reduce: reduceMotion)
            }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(ExpenseSavedNote(title: "Expense deleted", detail: "The record has been removed."), in: $note, reduce: reduceMotion)
            }
            .presentationSizing(.form)
        }
        .navigationDestination(item: $report) { t in
            PDFDocumentScreen(path: t.path, fileName: t.fileName, title: t.title)
        }
        .navigationDestination(isPresented: $openShareholders) {
            PlaceScreen(path: MoneyPaths.shareholders)
        }
        // Said for a few seconds, like the web's toast, then gone.
        .noteToast($note)
        .destructiveFeedback(trigger: deletion != nil)
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
        #if os(macOS)
        macTable(shown, summary: summary, range: range)
        #else
        List { Group {
            if !usedCategories.isEmpty {
                Section {
                    categoryChips
                        .chipRowInList()
                }
            }
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
                LedgerHeading(title: periodLine(range))
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
        }.houseRows()
        }
        .listStyle(.insetGrouped)
        .motion(category, Motion.travel)
        .motion(grouping, Motion.travel)
        .motion(period, Motion.travel)
        #endif
    }

    /// The page's Report for what is on screen; named as the browser saves it.
    private func reportTarget() -> InvoicePDFTarget {
        let path = MoneyPaths.expenseReport(period: period, fromDay: custom.fromDay, toDay: custom.toDay,
                                            grouping: grouping, category: category, search: search)
        return InvoicePDFTarget(path: path,
                                fileName: "Expense-Report-\(MoneyCalendar.pickedDay(Date())).pdf",
                                title: "Expense report")
    }

    /// "This month · 1 Oct – 8 Oct 2026".
    private func periodLine(_ range: MoneyDayRange) -> String {
        guard let caption = range.caption else { return period.title }
        return "\(period.title) · \(caption)"
    }

    /// Search and the period: everything but the category, which the chips choose.
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
        return ContentUnavailableView {
            Label("No expenses in this period", systemImage: "tray")
        } description: {
            Text(text)
        } actions: {
            Button("Add expense") { adding = true }.buttonStyle(.bordered)
        }
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
        // The row count is not said: the rows are right under it.
        return VStack(alignment: .leading, spacing: 6) {
            LedgerHeading(title: group.label, trailing: Money.pkr(group.total))
            if !group.sub.isEmpty {
                Text(group.sub).font(.footnote).foregroundStyle(.secondary)
            }
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
                    .tint(Color.secondary)
            } else {
                Button(role: .destructive) { askDelete(e) } label: { Label("Delete", systemImage: "trash") }
                Button { editing = e } label: { Label("Edit", systemImage: "pencil") }
                    .tint(Theme.accent)
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
        case .ammar: return MoneyPartners.name("ammar")
        case .mina: return MoneyPartners.name("mina")
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
    private var categoryChips: some View {
        let names = usedCategories
        if !names.isEmpty {
            ChipRow {
                chip("All", selected: category.isEmpty) { category = "" }
                ForEach(names, id: \.self) { (name: String) in
                    chip(name, selected: category == name) {
                        category = name
                    }
                }
            }
        }
    }

    /// No counts: the Payments tile says how many, once (rule 15).
    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        FilterChip(title: title, chosen: selected, action: action)
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
            Divider()
            Button { report = reportTarget() } label: {
                Label("Expense report (PDF)", systemImage: "doc.richtext")
            }
            .disabled(book.expenses.items.isEmpty)
        } label: {
            Label("Period and grouping", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }
}

#if os(macOS)

// MARK: - The Mac table

/// One expense as a table row, to sort by.
private struct ExpensesMacRow: Identifiable {
    let expense: Expense
    let who: String
    var id: String { expense.id }
    var day: String { MoneyMonths.day(expense.date) }
    var what: String { expense.description.isEmpty ? expense.category : expense.description }
    var category: String { expense.category }
    var amount: Double { expense.amount }
}

/// Expenses as a Mac page: every payment in the period as a sortable table (date, what, category, who, amount), the
/// period, grouping and category in the toolbar beside the Report, and the totals in a footer. ⏎ or a double-click edits
/// a row, the right-click menu and ⌫ delete it (asking for the delete code), and a partner's drawing points to Shareholders.
extension ExpensesScreen {
    private func macTable(_ shown: [MoneyLine<Expense>], summary: ExpenseSummary, range: MoneyDayRange) -> some View {
        let rows = shown.map { ExpensesMacRow(expense: $0.item, who: macWho($0.item)) }.sorted(using: macSort)
        return VStack(spacing: 0) {
            if period == .custom {
                HStack(spacing: 12) {
                    MoneyRangeFields(filter: $custom)
                    Spacer(minLength: 0)
                    Text(custom.useFrom ? "Without an end date it runs to the end of today." : "Until a start date is chosen, every expense is shown.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                Divider()
            }
            Table(rows, selection: $macPick, sortOrder: $macSort) {
                TableColumn("Date", value: \.day) { (r: ExpensesMacRow) in Text(ShopDate.say(r.expense.date)) }
                    .width(min: 90, ideal: 110)
                TableColumn("What", value: \.what)
                    .width(min: 160, ideal: 280)
                TableColumn("Category", value: \.category) { (r: ExpensesMacRow) in Text(r.category).foregroundStyle(.secondary) }
                    .width(min: 110, ideal: 150)
                TableColumn("Paid to", value: \.who) { (r: ExpensesMacRow) in Text(r.who).foregroundStyle(.secondary) }
                    .width(min: 110, ideal: 170)
                TableColumn("Amount", value: \.amount) { (r: ExpensesMacRow) in Text(Money.pkr(r.amount)).monospacedDigit() }
                    .width(min: 100, ideal: 120)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let e = rows.first(where: { $0.id == id })?.expense {
                    if ExpenseEditing.isDrawing(e, partnership: session.shop.partnership) {
                        Button { openShareholders = true } label: { Label("Change this on Shareholders", systemImage: "person.2") }
                    } else {
                        Button { editing = e } label: { Label("Edit", systemImage: "pencil") }
                        Button(role: .destructive) { askDelete(e) } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            } primaryAction: { ids in
                if let id = ids.first, let e = rows.first(where: { $0.id == id })?.expense {
                    if ExpenseEditing.isDrawing(e, partnership: session.shop.partnership) { openShareholders = true } else { editing = e }
                }
            }
            .onDeleteCommand {
                if macPick.count == 1, let id = macPick.first, let e = rows.first(where: { $0.id == id })?.expense,
                   !ExpenseEditing.isDrawing(e, partnership: session.shop.partnership) {
                    askDelete(e)
                }
            }
            .overlay { if rows.isEmpty { emptyState } }
            macFooter(summary)
        }
        .background(Theme.ground)
        .navigationSubtitle(periodLine(range))
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Period", selection: $period) {
                    ForEach(ExpensePeriod.allCases) { (p: ExpensePeriod) in Text(p.title).tag(p) }
                }
                .pickerStyle(.menu)
                .help("How far back to look")
            }
            ToolbarItem(placement: .automatic) {
                Picker("Group by", selection: $grouping) {
                    ForEach(ExpenseGrouping.allCases) { (g: ExpenseGrouping) in Text("By \(g.title.lowercased())").tag(g) }
                }
                .pickerStyle(.menu)
                .help("How coarsely the average and the biggest are bucketed")
            }
            ToolbarItem(placement: .automatic) {
                Picker("Category", selection: $category) {
                    Text("All categories").tag("")
                    ForEach(usedCategories, id: \.self) { (name: String) in Text(name).tag(name) }
                }
                .pickerStyle(.menu)
                .help("Only one category")
            }
            ToolbarItem(placement: .automatic) {
                Button { report = reportTarget() } label: { Label("Expense report (PDF)", systemImage: "doc.richtext") }
                    .disabled(book.expenses.items.isEmpty)
                    .help("The expense report for what is on screen, as a PDF")
            }
        }
    }

    /// The page's tiles as a footer a table has: total, payments, the average, the biggest, and the karigars' share.
    private func macFooter(_ s: ExpenseSummary) -> some View {
        let per = grouping.title.lowercased()
        return VStack(spacing: 0) {
            Divider()
            HStack(spacing: 22) {
                macFigure("Total", Money.pkr(s.total), tint: Theme.accent)
                macFigure("Payments", "\(s.count)")
                macFigure("Average per \(per)", Money.pkr(s.perBucket))
                macFigure("Biggest \(per)", Money.pkr(s.biggestTotal), detail: s.biggestLabel)
                macFigure("Karigar payments", Money.pkr(s.karigarTotal), detail: "\(s.karigarShare)% of total")
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .background(.bar)
    }

    private func macFigure(_ label: String, _ value: String, detail: String? = nil, tint: Color = .primary) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).foregroundStyle(tint).monospacedDigit()
            if let detail, !detail.isEmpty, detail != "\u{2014}" { Text(detail).font(.caption2).foregroundStyle(.secondary) }
        }
    }

    /// The karigar or partner it went to, and a partner who fronted the cash (the iPhone's row words).
    private func macWho(_ e: Expense) -> String {
        var parts: [String] = []
        if let kid = e.karigarId, let name = book.karigars.item(kid)?.name, !name.isEmpty { parts.append(name) }
        if let partner = MoneyPartners.name(e.shareholderId) { parts.append(partner) }
        if let payer = payerName(e.paidBy) { parts.append("paid by \(payer)") }
        return parts.joined(separator: " \u{00B7} ")
    }
}
#endif
