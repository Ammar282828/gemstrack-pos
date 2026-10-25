import SwiftUI
import ERPCore

/// Settings → Recently removed (src/app/settings/recently-removed/page.tsx): the way back from a clear-out
/// that went too far. Removing a customer or a karigar anywhere only hides them; their ledger, orders and
/// invoices stay where they are, still pointing at the same id, so putting one back restores a whole
/// account rather than a bare name. Each row says how much history it carries (ERPCore RecentlyRemoved).
///
/// Putting back is native (`restoreRemoved`). Emptying the list is the one thing in the ERP that destroys a
/// record: it says how much history goes with them, then asks for the delete code, which the ERP checks
/// with the delete (`purgeRemoved`, lib/writes/recently-removed.ts).
struct RecentlyRemovedScreen: View {
    @Environment(Session.self) private var session

    var body: some View {
        if session.isOwner {
            RecentlyRemovedList()
        } else {
            NotAvailableState("Owners only", why: "Settings are the owners’.")
                .navigationTitle("Recently removed")
        }
    }
}

private struct RecentlyRemovedList: View {
    @Environment(Book.self) private var book

    @State private var busy: String?
    @State private var failure: String?
    @State private var note: Note?
    @State private var confirmingEmpty = false
    /// Bumped on each put-back, so the success tap fires on the event.
    @State private var restoredCount = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var deletion: OwnerDeletion?
    @State private var history = Memo<[String: RecentlyRemoved.History]>()
    #if os(macOS)
    @State private var macSort = [KeyPathComparator(\RemovedMacRow.removedAt, order: .reverse)]
    @State private var macPick = Set<String>()
    @State private var macMade = Memo<RemovedMacData>()
    #endif

    private var ready: Bool { book.customers.loaded && book.karigars.loaded && book.hisaab.loaded && book.orders.loaded }

    private var removedCustomers: [Customer] { book.customers.items.filter { RecentlyRemoved.isRemoved($0.deletedAt) } }
    private var removedKarigars: [Karigar] { book.karigars.items.filter { RecentlyRemoved.isRemoved($0.deletedAt) } }

    var body: some View {
        ShelfState(loaded: ready, error: book.customers.error ?? book.karigars.error, offline: book.customers.offline) {
            content
        }
        .navigationTitle("Recently removed")
        .hubTitleDisplay()
        .failureAlert($failure, title: "Could not do that")
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
        }
        .noteToast($note)
        .confirmDestructive(isPresented: $confirmingEmpty, title: "Empty Recently removed?",
                            message: "Everyone listed here is deleted for good. The delete code is asked next.",
                            action: "Continue") {
            askToEmpty(removedCustomers, removedKarigars, reckon())
        }
        .task {
            book.customers.need()
            book.karigars.need()
            book.hisaab.need()
            book.orders.need()
        }
    }

    private func reckon() -> [String: RecentlyRemoved.History] {
        history([book.hisaab.revision, book.orders.revision]) {
            RecentlyRemoved.removedHistory(hisaab: book.hisaab.items, orders: book.orders.items)
        }
    }

    // MARK: The page

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
        macTable()
        #else
        let customers = removedCustomers
        let karigars = removedKarigars
        let h = reckon()
        List {
            Group {
                if !(customers.isEmpty && karigars.isEmpty) {
                    summarySection(customers, karigars, h)
                    if !customers.isEmpty {
                        LedgerSection("Customers") {
                            ForEach(customers) { (c: Customer) in
                                row(id: c.id, name: c.name, sub: c.phone, removedAt: c.deletedAt, kind: .customer, history: h[c.id])
                            }
                        }
                    }
                    if !karigars.isEmpty {
                        LedgerSection("Karigars") {
                            ForEach(karigars) { (k: Karigar) in
                                row(id: k.id, name: k.name, sub: k.contact, removedAt: k.deletedAt, kind: .karigar, history: h[k.id])
                            }
                        }
                    }
                    emptySection
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .motion(customers.count + karigars.count)
        .overlay {
            if customers.isEmpty && karigars.isEmpty {
                NotAvailableState("Nobody has been removed", why: "Their history is exactly where they left it.",
                                  symbol: "arrow.uturn.backward")
            }
        }
        #endif
    }

    /// "1 customer", "2 customers".
    private func plural(_ n: Int, _ noun: String) -> String { "\(n) \(noun)\(n == 1 ? "" : "s")" }

    private func summarySection(_ customers: [Customer], _ karigars: [Karigar], _ h: [String: RecentlyRemoved.History]) -> some View {
        let total = customers.count + karigars.count
        return Section {
            Button {
                Task { await restore(customerIds: customers.map(\.id), karigarIds: karigars.map(\.id), key: "all", name: nil) }
            } label: {
                HStack(spacing: pt(8)) {
                    if busy == "all" { SkeletonLoading() }
                    Label("Put everything back", systemImage: "arrow.uturn.backward")
                }
            }
            .disabled(busy != nil)
        } header: {
            LedgerHeading(title: "\(total) removed")
        } footer: {
            Text("\(plural(customers.count, "customer")), \(plural(karigars.count, "karigar")). Nothing here has been destroyed. Their history is exactly where they left it.")
        }
    }

    /// Emptying is the one thing that destroys a record: alone in the last section, away from Put everything back.
    /// It asks first, then the sheet says what goes and what it orphans before it takes the code.
    private var emptySection: some View {
        Section {
            Button(role: .destructive) { confirmingEmpty = true } label: {
                Label("Empty", systemImage: "trash")
            }
            .disabled(busy != nil)
        } footer: {
            Text("Deletes everyone listed above for good. This cannot be undone.")
        }
    }

    /// The page's warning, counted out loud: what goes, and the history it leaves orphaned.
    private func emptyWarning(_ customers: [Customer], _ karigars: [Karigar], _ h: [String: RecentlyRemoved.History]) -> String {
        let t = RecentlyRemoved.removedTotals(customerIds: customers.map(\.id), karigarIds: karigars.map(\.id), history: h)
        var said = "This permanently deletes \(plural(customers.count, "customer")) and \(plural(karigars.count, "karigar"))."
        if t.entries > 0 || t.orders > 0 {
            said += " They carry \(t.entries) ledger entr\(t.entries == 1 ? "y" : "ies") and \(t.orders) order\(t.orders == 1 ? "" : "s") between them, which will be orphaned."
        }
        return said + " This is the one thing in the app that cannot be undone."
    }

    private func askToEmpty(_ customers: [Customer], _ karigars: [Karigar], _ h: [String: RecentlyRemoved.History]) {
        let customerIds = customers.map(\.id)
        let karigarIds = karigars.map(\.id)
        deletion = OwnerDeletion(
            what: "Delete every removed customer and karigar for good",
            detail: "Empty Recently removed? " + emptyWarning(customers, karigars, h)
        ) { code in
            let out = try await ERPAPI.shared.write("purgeRemoved", ["customerIds": customerIds, "karigarIds": karigarIds, "deleteCode": code])
            let c = out["customers"] as? Int ?? 0
            let k = out["karigars"] as? Int ?? 0
            Note.show(Note(title: "Recently removed emptied", detail: "\(plural(c, "customer")) and \(plural(k, "karigar")) permanently deleted."),
                      in: $note, reduce: reduceMotion)
        }
    }

    // MARK: One person

    private enum Kind { case customer, karigar }

    private func row(id: String, name: String, sub: String?, removedAt: String?, kind: Kind, history: RecentlyRemoved.History?) -> some View {
        let carries = RecentlyRemoved.carriesText(history)
        let line = [sub ?? "", carries.isEmpty ? "no history" : carries].filter { !$0.isEmpty }.joined(separator: " \u{2014} ")
        let when = ShopDate.say(removedAt)
        return HStack(spacing: pt(12)) {
            Image(systemName: kind == .customer ? "person.2" : "hammer").foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(name.isEmpty ? id : name).fontWeight(.medium).lineLimit(1)
                Text(line).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                if !when.isEmpty {
                    Text("Removed \(when)").font(.caption).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 8)
            Button {
                Task {
                    await restore(customerIds: kind == .customer ? [id] : [], karigarIds: kind == .karigar ? [id] : [], key: id, name: name)
                }
            } label: {
                if busy == id { SkeletonLoading() } else { Text("Put back") }
            }
            .buttonStyle(.bordered)
            .frame(minWidth: 72)
            .disabled(busy != nil)
        }
    }

    /// Put back one person, or everyone listed (the ERP restores only those still removed).
    private func restore(customerIds: [String], karigarIds: [String], key: String, name: String?) async {
        busy = key
        do {
            let out = try await ERPAPI.shared.write("restoreRemoved", ["customerIds": customerIds, "karigarIds": karigarIds])
            let back = (out["customers"] as? [Any] ?? []).count + (out["karigars"] as? [Any] ?? []).count
            let said: Note
            if back == 0 {
                // Someone put them back already (or they are gone): the list catches up by itself.
                said = Note(title: "Nothing to put back", detail: "They are no longer in Recently removed.")
            } else if let name {
                said = Note(title: "Put back", detail: "\(name.isEmpty ? "They are" : "\(name) is") in the book again.")
            } else {
                said = Note(title: "Put everything back", detail: "\(back) \(back == 1 ? "record" : "records") restored.")
            }
            restoredCount += 1
            Note.show(said, in: $note, reduce: reduceMotion)
        } catch {
            failure = error.localizedDescription
        }
        busy = nil
    }
}

#if os(macOS)

// MARK: - The Mac table

/// One removed customer or karigar as a table row.
private struct RemovedMacRow: Identifiable {
    let id: String
    let name: String
    let isCustomer: Bool
    let contact: String
    let carries: String
    let removedAt: String
    /// The date as the shop says it, worked out once with the row.
    let said: String
    var kind: String { isCustomer ? "Customer" : "Karigar" }
}

/// What the table draws, worked out once per change of the books or of the sort (`Memo`): the shelves are walked for the
/// removed ones here and nowhere in `body`.
private struct RemovedMacData {
    let rows: [RemovedMacRow]
    let customerIds: [String]
    let karigarIds: [String]
}

/// Recently removed as a Mac page: everyone removed as a sortable table (who, what history they carry, when), "Put back" for
/// the selected rows from the toolbar, the Removed menu or the right-click menu (⌘Return); "Put everything back" and "Empty"
/// (which asks, then asks for the delete code) are in the toolbar's More menu. Putting back and emptying are the page's own.
extension RecentlyRemovedList {
    private func macData() -> RemovedMacData {
        let key = [book.customers.revision, book.karigars.revision, book.hisaab.revision, book.orders.revision, macSort.hashValue]
        return macMade(key) {
            let customers = removedCustomers
            let karigars = removedKarigars
            let h = reckon()
            var all: [RemovedMacRow] = []
            for c in customers {
                let carries = RecentlyRemoved.carriesText(h[c.id])
                all.append(RemovedMacRow(id: c.id, name: c.name.isEmpty ? c.id : c.name, isCustomer: true, contact: c.phone ?? "",
                                         carries: carries.isEmpty ? "no history" : carries, removedAt: c.deletedAt ?? "",
                                         said: ShopDate.say(c.deletedAt ?? "")))
            }
            for k in karigars {
                let carries = RecentlyRemoved.carriesText(h[k.id])
                all.append(RemovedMacRow(id: k.id, name: k.name.isEmpty ? k.id : k.name, isCustomer: false, contact: k.contact ?? "",
                                         carries: carries.isEmpty ? "no history" : carries, removedAt: k.deletedAt ?? "",
                                         said: ShopDate.say(k.deletedAt ?? "")))
            }
            return RemovedMacData(rows: all.sorted(using: macSort), customerIds: customers.map(\.id), karigarIds: karigars.map(\.id))
        }
    }

    private func macPutBackAction(_ picked: [RemovedMacRow]) -> MacAction {
        MacAction(picked.count > 1 ? "Put \(picked.count) Back" : "Put Back", symbol: "arrow.uturn.backward",
                  shortcut: KeyboardShortcut(.return, modifiers: .command), enabled: !picked.isEmpty && busy == nil,
                  isDefault: true, id: "back") { macPutBack(picked) }
    }

    private func macPutAllAction(_ data: RemovedMacData) -> MacAction {
        MacAction("Put Everything Back", symbol: "arrow.uturn.backward.circle", enabled: busy == nil && !data.rows.isEmpty, id: "all") {
            Task { await restore(customerIds: data.customerIds, karigarIds: data.karigarIds, key: "all", name: nil) }
        }
    }

    private var macEmptyAction: MacAction {
        MacAction("Empty\u{2026}", symbol: "trash", role: .destructive, enabled: busy == nil, id: "empty") { confirmingEmpty = true }
    }

    private func macTable() -> some View {
        let data = macData()
        let rows = data.rows
        let picked = rows.filter { macPick.contains($0.id) }
        let putBack = macPutBackAction(picked)
        let putAll = macPutAllAction(data)
        return Table(rows, selection: $macPick, sortOrder: $macSort) {
            TableColumn("Name", value: \.name) { (r: RemovedMacRow) in
                HStack(spacing: 8) {
                    Image(systemName: r.isCustomer ? "person.2" : "hammer").foregroundStyle(.secondary)
                    Text(r.name).lineLimit(1)
                }
            }
            .width(min: 120, ideal: 200)
            TableColumn("Who", value: \.kind) { (r: RemovedMacRow) in Text(r.kind).foregroundStyle(.secondary) }
                .width(min: 70, ideal: 90)
            TableColumn("Contact", value: \.contact) { (r: RemovedMacRow) in
                Text(r.contact).monospacedDigit().lineLimit(1).foregroundStyle(.secondary)
            }
            .width(min: 90, ideal: 120)
            TableColumn("History they carry", value: \.carries) { (r: RemovedMacRow) in
                Text(r.carries).lineLimit(1).foregroundStyle(.secondary)
            }
            .width(min: 120, ideal: 200)
            TableColumn("Removed", value: \.removedAt) { (r: RemovedMacRow) in Text(r.said).lineLimit(1) }
                .width(min: 70, ideal: 90)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            let chosen = rows.filter { ids.contains($0.id) }
            if !chosen.isEmpty {
                Button(chosen.count == 1 ? "Put Back" : "Put \(chosen.count) Back") { macPutBack(chosen) }
                    .disabled(busy != nil)
            }
        } primaryAction: { ids in
            let chosen = rows.filter { ids.contains($0.id) }
            if !chosen.isEmpty { macPutBack(chosen) }
        }
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView("Nobody Removed", systemImage: "arrow.uturn.backward",
                                       description: Text("A customer or karigar you remove waits here, with all their history, to be put back."))
            }
        }
        .background(Theme.ground)
        .navigationSubtitle(rows.isEmpty ? "" : "\(rows.count) removed")
        .macSummaryBar(rows.isEmpty ? [] : ["\(rows.count) removed", "Nothing here has been destroyed; their history is exactly where they left it"])
        .macRecordMenu(MacRecordMenu(title: "Removed", groups: [[putBack], [putAll], [macEmptyAction]]))
        .toolbar {
            if !rows.isEmpty {
                ToolbarItemGroup(placement: .automatic) {
                    MacToolbarAction(action: putBack)
                    Menu {
                        MacActionItems(groups: [[putAll], [macEmptyAction]])
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                    .help("Put everyone back, or delete everyone listed for good (it asks, then asks for the delete code)")
                }
            }
        }
    }

    private func macPutBack(_ chosen: [RemovedMacRow]) {
        guard !chosen.isEmpty else { return }
        let customerIds = chosen.filter { $0.isCustomer }.map(\.id)
        let karigarIds = chosen.filter { !$0.isCustomer }.map(\.id)
        let single = chosen.count == 1 ? chosen[0] : nil
        Task { await restore(customerIds: customerIds, karigarIds: karigarIds, key: single?.id ?? "some", name: single?.name) }
    }
}
#endif
