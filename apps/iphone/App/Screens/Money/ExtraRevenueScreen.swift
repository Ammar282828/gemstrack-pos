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
    @State private var note: Note?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var macSort = [KeyPathComparator(\ExtraRevenueMacRow.day, order: .reverse)]
    @State private var macPick = Set<String>()
    @State private var macGo: Route?
    @State private var macMade = Memo<[ExtraRevenueMacRow]>()
    #endif

    var body: some View {
        if session.isOwner {
            #if os(macOS)
            macOwners
            #else
            owners
            #endif
        } else {
            MoneyOwnersOnly(title: "Extra revenue")
        }
    }

    private var owners: some View {
        ShelfState(loaded: book.revenue.loaded, error: book.revenue.error, offline: book.revenue.offline) {
            content
        }
        .navigationTitle("Extra revenue")
        .hubTitleDisplay()
        .searchable(text: $search, prompt: "Search by description")
        .toolbar {
            ToolbarItem(placement: .trailingAction) {
                Button { adding = true } label: { Label("Add extra revenue", systemImage: "plus") }
                #if os(macOS)
                    .keyboardShortcut("e", modifiers: [.command, .shift])
                    .help("Add extra revenue (\u{21E7}\u{2318}E)")
                #endif
            }
        }
        .sheet(isPresented: $adding) {
            RevenueEditSheet(editing: nil) { (saved: Note) in Note.show(saved, in: $note, reduce: reduceMotion) }
        }
        .sheet(item: $editing) { (r: AdditionalRevenue) in
            RevenueEditSheet(editing: r) { (saved: Note) in Note.show(saved, in: $note, reduce: reduceMotion) }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(Note(title: "Deleted", detail: "Revenue entry deleted."), in: $note, reduce: reduceMotion)
            }
            .presentationSizing(.form)
        }
        .noteToast($note)
        .destructiveFeedback(trigger: deletion != nil)
        .task { book.revenue.need() }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
        macContent
        #else
        let shown = lines()
        let months = MoneyMonths.group(shown, amount: { (r: AdditionalRevenue) -> Double in r.amount })
        List { Group {
            Section {
                figures(shown)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }
            Section {
                MoneyRangeFields(filter: $dates)
            } header: {
                LedgerHeading(title: "Dates")
            } footer: {
                Text(dates.useFrom ? "Without an end date it runs to the end of today." : "Until a start date is chosen, every entry is shown.")
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
        #endif
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
        return FigureRow(alignment: .top, spacing: pt(10)) {
            FigureTile(label: "Total revenue", value: Money.pkr(total), tint: Theme.accent)
        }
        .padding(.vertical, pt(4))
    }

    private func monthHeader(_ month: MoneyMonth<AdditionalRevenue>) -> some View {
        return VStack(alignment: .leading, spacing: pt(6)) {
            LedgerHeading(title: month.title, trailing: Money.pkr(month.total))
            if !month.hint.isEmpty {
                Text(month.hint).font(.footnote).foregroundStyle(.secondary)
            }
        }
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
                    subtitle: when.isEmpty ? nil : when,
                    trailing: Money.pkr(r.amount)
                )
            }
        } else {
            TwoLine(title: r.description, subtitle: when, trailing: Money.pkr(r.amount))
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

#if os(macOS)

// MARK: - The Mac table

/// One revenue entry as a table row, to sort by.
private struct ExtraRevenueMacRow: Identifiable {
    let revenue: AdditionalRevenue
    let day: String
    let what: String
    let amount: Double
    let onRepair: Bool
    /// The date as the shop says it, worked out once with the row rather than per drawing.
    let said: String
    var id: String { revenue.id }

    init(_ r: AdditionalRevenue) {
        revenue = r
        said = ShopDate.say(r.date)
        day = MoneyMonths.day(r.date)
        what = r.description
        amount = r.amount
        onRepair = !(r.repairId ?? "").isEmpty
    }
}

/// Extra revenue as a Mac place (docs/features/mac-design.md, "Money"): every entry as a sortable table, the date range as a
/// bar over it, the total in the summary bar. The Revenue menu is New Revenue… (a sheet), Edit… (Return, or a double-click)
/// and Delete… (asks for the delete code); money taken on a repair opens that repair in a window instead.
extension ExtraRevenueScreen {
    @ViewBuilder
    var macOwners: some View {
        ShelfState(loaded: book.revenue.loaded, error: book.revenue.error, offline: book.revenue.offline) {
            macContent
        }
        .navigationTitle("Extra revenue")
        .macSearchable(text: $search, prompt: "Search Extra Revenue")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                MacToolbarAction(action: macGroups(for: macPick)[0][0])
            }
        }
        .macRecordMenu(MacRecordMenu(title: "Revenue", groups: macGroups(for: macPick)))
        .sheet(isPresented: $adding) {
            RevenueEditSheet(editing: nil) { (saved: Note) in Note.show(saved, in: $note, reduce: reduceMotion) }
        }
        .sheet(item: $editing) { (r: AdditionalRevenue) in
            RevenueEditSheet(editing: r) { (saved: Note) in Note.show(saved, in: $note, reduce: reduceMotion) }
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Note.show(Note(title: "Deleted", detail: "Revenue entry deleted."), in: $note, reduce: reduceMotion)
            }
            .presentationSizing(.form)
        }
        .noteToast($note)
        .navigationDestination(item: $macGo) { (r: Route) in PlaceScreen(path: r.path) }
        .task { book.revenue.need() }
    }

    @ViewBuilder
    var macContent: some View {
        let rows = macRows()
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                MoneyRangeFields(filter: $dates)
                Spacer(minLength: 0)
                Text(dates.useFrom ? "Without an end date it runs to the end of today." : "Until a start date is chosen, every entry is shown.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            Divider()
            Table(rows, selection: $macPick, sortOrder: $macSort) {
                TableColumn("Date", value: \.day) { (r: ExtraRevenueMacRow) in Text(r.said).lineLimit(1) }
                    .width(min: 70, ideal: 100)
                TableColumn("What", value: \.what) { (r: ExtraRevenueMacRow) in Text(r.what).lineLimit(1) }
                    .width(min: 120, ideal: 280)
                TableColumn("Source") { (r: ExtraRevenueMacRow) in
                    Text(r.onRepair ? "A repair" : "").foregroundStyle(.secondary)
                }
                .width(min: 70, ideal: 90)
                TableColumn("Amount", value: \.amount) { (r: ExtraRevenueMacRow) in MacAmount(r.amount) }
                    .width(min: 70, ideal: 90)
            }
            .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
                MacActionItems(groups: macGroups(for: ids))
                if let r = macEntry(ids), let repairId = r.repairId, !repairId.isEmpty {
                    Divider()
                    Button("Open Repair in New Window") { macOpen(Route(path: MoneyPaths.repair(repairId))) }
                }
            } primaryAction: { (ids: Set<String>) in
                if let r = macEntry(ids) { macEdit(r) }
            }
            .onDeleteCommand {
                if let r = macEntry(macPick), (r.repairId ?? "").isEmpty { askDelete(r) }
            }
            .overlay {
                if rows.isEmpty {
                    ContentUnavailableView("No revenue entries found", systemImage: "chart.line.uptrend.xyaxis",
                                           description: Text(search.isEmpty && !dates.useFrom ? "Add one with \u{2303}\u{2318}N." : "Try adjusting your search or the dates."))
                }
            }
        }
        .macSummaryBar(macSummary(rows))
    }

    // MARK: Worked out once

    private func macRows() -> [ExtraRevenueMacRow] {
        let key = [book.revenue.revision, search.hashValue, (dates.fromDay ?? "").hashValue, (dates.toDay ?? "").hashValue,
                   macSort.hashValue, MoneyCalendar.pickedDay(Date()).hashValue]
        return macMade(key) {
            lines().map { (l: MoneyLine<AdditionalRevenue>) in ExtraRevenueMacRow(l.item) }.sorted(using: macSort)
        }
    }

    private func macSummary(_ rows: [ExtraRevenueMacRow]) -> [String] {
        let picked = macPick.count > 1 ? rows.filter { (r: ExtraRevenueMacRow) in macPick.contains(r.id) } : rows
        let total = picked.reduce(0.0) { (sum: Double, r: ExtraRevenueMacRow) in sum + r.amount }
        let words = macPick.count > 1 ? ["\(picked.count) selected"] : ["\(rows.count) entr\(rows.count == 1 ? "y" : "ies")"]
        return words + [(macPick.count > 1 ? "" : "Total revenue ") + Money.pkr(total)]
    }

    // MARK: The actions, declared once

    private func macEntry(_ ids: Set<String>) -> AdditionalRevenue? {
        guard ids.count == 1, let id = ids.first else { return nil }
        return book.revenue.item(id)
    }

    /// Money taken on a repair is changed on the repair; any other entry opens the edit sheet.
    private func macEdit(_ r: AdditionalRevenue) {
        if let repairId = r.repairId, !repairId.isEmpty { macOpen(Route(path: MoneyPaths.repair(repairId))) } else { editing = r }
    }

    /// A record in a window of its own; in the stack where windows are not offered.
    private func macOpen(_ route: Route) {
        if let openPlace { openPlace(route) } else { macGo = route }
    }

    private func macGroups(for ids: Set<String>) -> [[MacAction]] {
        let r = macEntry(ids)
        let onRepair = !(r?.repairId ?? "").isEmpty
        let add = MacAction("New Revenue\u{2026}", symbol: "plus", shortcut: KeyboardShortcut("n", modifiers: [.control, .command]),
                            id: "new") { adding = true }
        let edit = MacAction(onRepair ? "Open Repair" : "Edit\u{2026}", symbol: onRepair ? "wrench.and.screwdriver" : "pencil",
                             shortcut: KeyboardShortcut(.return, modifiers: []), enabled: r != nil, id: "edit") {
            if let r { macEdit(r) }
        }
        let delete = MacAction("Delete\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                               role: .destructive, enabled: r != nil && !onRepair, id: "delete") {
            if let r { askDelete(r) }
        }
        return [[add], [edit], [delete]]
    }
}
#endif
