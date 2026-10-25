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
    @State private var macMade = Memo<ExpensesMacData>()
    @State private var macCategoriesMade = Memo<[String]>()
    #endif

    var body: some View {
        if session.isOwner {
            #if os(macOS)
            macOwners
            #else
            owners
            #endif
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
        #if os(macOS)
        macContent
        #else
        let now = Date()
        let range = period.range(customFrom: custom.fromDay, customTo: custom.toDay, now: now)
        let scoped = scopedLines(range)
        let shown = category.isEmpty ? scoped : scoped.filter { $0.item.category == category }
        let groups = MoneyBuckets.group(shown, by: grouping, now: now, amount: { (e: Expense) -> Double in e.amount })
        let summary = ExpenseFigures.summary(shown, groups: groups)
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
        return VStack(spacing: pt(10)) {
            FigureRow(alignment: .top, spacing: pt(10)) {
                FigureTile(label: "Total expenses", value: Money.pkr(s.total), tint: Theme.accent)
                FigureTile(label: "Payments", value: "\(s.count)", detail: category.isEmpty ? nil : category)
            }
            DisclosureGroup("Spending breakdown") {
                VStack(spacing: pt(12)) {
                    TwoLine(title: "Average per \(per)", trailing: Money.pkr(s.perBucket))
                    TwoLine(title: "Karigar payments", subtitle: "\(s.karigarShare)% of total", trailing: Money.pkr(s.karigarTotal))
                    TwoLine(title: "Biggest \(per)", subtitle: s.biggestLabel, trailing: Money.pkr(s.biggestTotal))
                }
                .padding(.top, pt(12))
            }
            .font(.subheadline)
            .ledgerCard()
        }
        .padding(.vertical, pt(4))
    }

    private func groupHeader(_ group: MoneyGroup<Expense>) -> some View {
        // The row count is not said: the rows are right under it.
        return VStack(alignment: .leading, spacing: pt(6)) {
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
    let day: String
    let what: String
    let category: String
    let amount: Double
    /// The date as the shop says it, worked out once with the row rather than per drawing.
    let said: String
    var id: String { expense.id }

    init(_ e: Expense, who: String) {
        expense = e
        self.who = who
        said = ShopDate.say(e.date)
        day = MoneyMonths.day(e.date)
        what = e.description.isEmpty ? e.category : e.description
        category = e.category
        amount = e.amount
    }
}

/// What the table draws, worked out once per change of the books, the filters or the sort (`Memo`).
private struct ExpensesMacData {
    let rows: [ExpensesMacRow]
    let summary: ExpenseSummary
    let range: MoneyDayRange
}

/// Expenses as a Mac place (docs/features/mac-design.md, "Money"): every payment in the period as a sortable table (date,
/// what, category, paid to, amount), the period, grouping and category as one Filter menu in the toolbar beside New, the
/// totals in the summary bar. The Expense menu is New Expense… (a sheet), Edit… (Return, or a double-click), the report as
/// a PDF and Delete… (asks for the delete code, as ever); a partner's drawing points to Shareholders.
extension ExpensesScreen {
    @ViewBuilder
    var macOwners: some View {
        ShelfState(loaded: book.expenses.loaded, error: book.expenses.error, offline: book.expenses.offline) {
            macContent
        }
        .navigationTitle("Expenses")
        .macSearchable(text: $search, prompt: "Search Expenses")
        .toolbar { macToolbar }
        .macRecordMenu(MacRecordMenu(title: "Expense", groups: macGroups(for: macPick)))
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
        .noteToast($note)
        .task {
            book.expenses.need()
            book.karigars.need()
            book.karigarBatches.need()
        }
    }

    // MARK: Worked out once

    private func macData() -> ExpensesMacData {
        let key = [book.expenses.revision, book.karigars.revision, search.hashValue, period.hashValue, grouping.hashValue,
                   category.hashValue, (custom.fromDay ?? "").hashValue, (custom.toDay ?? "").hashValue,
                   macSort.hashValue, MoneyCalendar.pickedDay(Date()).hashValue]
        return macMade(key) {
            let now = Date()
            let range = period.range(customFrom: custom.fromDay, customTo: custom.toDay, now: now)
            let scoped = scopedLines(range)
            let shown = category.isEmpty ? scoped : scoped.filter { (l: MoneyLine<Expense>) in l.item.category == category }
            let groups = MoneyBuckets.group(shown, by: grouping, now: now, amount: { (e: Expense) -> Double in e.amount })
            let summary = ExpenseFigures.summary(shown, groups: groups)
            let rows = shown.map { (l: MoneyLine<Expense>) in ExpensesMacRow(l.item, who: macWho(l.item)) }.sorted(using: macSort)
            return ExpensesMacData(rows: rows, summary: summary, range: range)
        }
    }

    // MARK: The table

    @ViewBuilder
    var macContent: some View {
        let data = macData()
        let rows = data.rows
        VStack(spacing: 0) {
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
                TableColumn("Date", value: \.day) { (r: ExpensesMacRow) in Text(r.said).lineLimit(1) }
                    .width(min: 70, ideal: 100)
                TableColumn("What", value: \.what) { (r: ExpensesMacRow) in Text(r.what).lineLimit(1) }
                    .width(min: 120, ideal: 240)
                TableColumn("Category", value: \.category) { (r: ExpensesMacRow) in
                    Text(r.category).lineLimit(1).foregroundStyle(.secondary)
                }
                .width(min: 90, ideal: 130)
                TableColumn("Paid to", value: \.who) { (r: ExpensesMacRow) in
                    Text(r.who).lineLimit(1).foregroundStyle(.secondary)
                }
                .width(min: 90, ideal: 150)
                TableColumn("Amount", value: \.amount) { (r: ExpensesMacRow) in MacAmount(r.amount) }
                    .width(min: 70, ideal: 90)
            }
            .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
                MacActionItems(groups: macGroups(for: ids))
            } primaryAction: { (ids: Set<String>) in
                if let e = macExpense(ids) { macEdit(e) }
            }
            .onDeleteCommand {
                if let e = macExpense(macPick), !ExpenseEditing.isDrawing(e, partnership: session.shop.partnership) { askDelete(e) }
            }
            .overlay { if rows.isEmpty { macEmptyState } }
        }
        .macSummaryBar(macSummary(rows, data.summary))
        .navigationSubtitle(periodLine(data.range))
    }

    @ViewBuilder
    private var macEmptyState: some View {
        let filtering = !search.isEmpty || !category.isEmpty
        ContentUnavailableView {
            Label("No expenses in this period", systemImage: "tray")
        } description: {
            Text(filtering ? "Select a wider period, or clear the filters."
                           : "No expenses recorded for \(period.title.lowercased()). Add one with \u{2303}\u{2318}N.")
        }
    }

    /// The page's tiles as the one line a list ends in: the payments and their total, the average and the biggest of the
    /// grouping, and the karigars' share; with rows picked, the picked rows' own sum.
    private func macSummary(_ rows: [ExpensesMacRow], _ s: ExpenseSummary) -> [String] {
        if macPick.count > 1 {
            let picked = rows.filter { (r: ExpensesMacRow) in macPick.contains(r.id) }
            let sum = picked.reduce(0.0) { (total: Double, r: ExpensesMacRow) in total + r.amount }
            return ["\(picked.count) selected", Money.pkr(sum)]
        }
        let per = grouping.title.lowercased()
        var parts = ["\(s.count) payment\(s.count == 1 ? "" : "s")", "Total \(Money.pkr(s.total))"]
        if s.count > 0 {
            parts.append("Average per \(per) \(Money.pkrLac(s.perBucket))")
            if s.biggestTotal > 0 { parts.append("Biggest \(per) \(Money.pkrLac(s.biggestTotal)) (\(s.biggestLabel))") }
        }
        if s.karigarTotal > 0 { parts.append("Karigar payments \(Money.pkrLac(s.karigarTotal)) (\(s.karigarShare)%)") }
        return parts
    }

    // MARK: The actions, declared once

    private func macExpense(_ ids: Set<String>) -> Expense? {
        guard ids.count == 1, let id = ids.first else { return nil }
        return book.expenses.item(id)
    }

    /// A partner's drawing is the Shareholders page's to change; any other row opens the edit sheet.
    private func macEdit(_ e: Expense) {
        if ExpenseEditing.isDrawing(e, partnership: session.shop.partnership) { openShareholders = true } else { editing = e }
    }

    private func macGroups(for ids: Set<String>) -> [[MacAction]] {
        let e = macExpense(ids)
        let drawing = e.map { (x: Expense) in ExpenseEditing.isDrawing(x, partnership: session.shop.partnership) } ?? false
        let add = MacAction("New Expense\u{2026}", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                            id: "new") { adding = true }
        let edit = MacAction(drawing ? "Change on Shareholders" : "Edit\u{2026}", symbol: drawing ? "person.2" : "pencil",
                             shortcut: KeyboardShortcut(.return, modifiers: []), enabled: e != nil, id: "edit") {
            if let e { macEdit(e) }
        }
        let delete = MacAction("Delete\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                               role: .destructive, enabled: e != nil && !drawing, id: "delete") {
            if let e { askDelete(e) }
        }
        // The page's own report, drawn by the ERP for the period, grouping and category on screen.
        let pdf = MacAction("Expense Report (PDF)\u{2026}", symbol: "doc.richtext", enabled: !book.expenses.items.isEmpty, id: "report") {
            report = reportTarget()
        }
        return [[add], [edit], [pdf], [delete]]
    }

    /// New, and the one Filter menu (period, grouping and category inline in it): a Tahoe toolbar of five capsules overflowed.
    @ToolbarContentBuilder
    private var macToolbar: some ToolbarContent {
        let add = macGroups(for: macPick)[0][0]
        ToolbarItemGroup(placement: .primaryAction) {
            MacToolbarAction(action: add)
            macFilterMenu
        }
    }

    /// The filter's categories, worked out once per change of the expenses (the toolbar is drawn on every click on a row).
    private var macCategories: [String] {
        macCategoriesMade([book.expenses.revision, session.shop.expenseCategories.hashValue]) { usedCategories }
    }

    private var macFiltering: Bool { period != .thisMonth || grouping != .day || !category.isEmpty }

    private var macFilterMenu: some View {
        Menu {
            Section("Period") {
                Picker("Period", selection: $period) {
                    ForEach(ExpensePeriod.allCases) { (p: ExpensePeriod) in Text(p.title).tag(p) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("Group by") {
                Picker("Group by", selection: $grouping) {
                    ForEach(ExpenseGrouping.allCases) { (g: ExpenseGrouping) in Text("By \(g.title.lowercased())").tag(g) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("Category") {
                Picker("Category", selection: $category) {
                    Text("All categories").tag("")
                    ForEach(macCategories, id: \.self) { (name: String) in Text(name).tag(name) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
        } label: {
            Label("Filter", systemImage: macFiltering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .help("How far back to look, how coarsely to group, and one category")
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
