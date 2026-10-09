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
            ContentUnavailableView("Owners only", systemImage: "lock", description: Text("Settings are the owners’."))
                .navigationTitle("Recently removed")
        }
    }
}

private struct RecentlyRemovedList: View {
    @Environment(Book.self) private var book

    @State private var busy: String?
    @State private var failure: String?
    @State private var note: OwnerNote?
    @State private var deletion: OwnerDeletion?
    @State private var history = Memo<[String: RecentlyRemoved.History]>()

    private var ready: Bool { book.customers.loaded && book.karigars.loaded && book.hisaab.loaded && book.orders.loaded }

    private var removedCustomers: [Customer] { book.customers.items.filter { RecentlyRemoved.isRemoved($0.deletedAt) } }
    private var removedKarigars: [Karigar] { book.karigars.items.filter { RecentlyRemoved.isRemoved($0.deletedAt) } }

    var body: some View {
        ShelfState(loaded: ready, error: book.customers.error ?? book.karigars.error, offline: book.customers.offline) {
            content
        }
        .navigationTitle("Recently removed")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Could not do that", isPresented: failureShown) {
            Button("OK") { failure = nil }
        } message: {
            Text(failure ?? "")
        }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
        }
        .ownerNote($note)
        .task {
            book.customers.need()
            book.karigars.need()
            book.hisaab.need()
            book.orders.need()
        }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { (on: Bool) in if !on { failure = nil } })
    }

    private func reckon() -> [String: RecentlyRemoved.History] {
        history([book.hisaab.revision, book.orders.revision]) {
            RecentlyRemoved.removedHistory(hisaab: book.hisaab.items, orders: book.orders.items)
        }
    }

    // MARK: The page

    @ViewBuilder
    private var content: some View {
        let customers = removedCustomers
        let karigars = removedKarigars
        let h = reckon()
        List {
            Group {
                if customers.isEmpty && karigars.isEmpty {
                    Section {
                        ContentUnavailableView("Nobody has been removed", systemImage: "arrow.uturn.backward",
                                               description: Text("Nothing here has been destroyed. Their history is exactly where they left it."))
                    }
                } else {
                    summarySection(customers, karigars, h)
                    if !customers.isEmpty {
                        Section("Customers") {
                            ForEach(customers) { (c: Customer) in
                                row(id: c.id, name: c.name, sub: c.phone, removedAt: c.deletedAt, kind: .customer, history: h[c.id])
                            }
                        }
                    }
                    if !karigars.isEmpty {
                        Section("Karigars") {
                            ForEach(karigars) { (k: Karigar) in
                                row(id: k.id, name: k.name, sub: k.contact, removedAt: k.deletedAt, kind: .karigar, history: h[k.id])
                            }
                        }
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
    }

    private func summarySection(_ customers: [Customer], _ karigars: [Karigar], _ h: [String: RecentlyRemoved.History]) -> some View {
        let total = customers.count + karigars.count
        return Section {
            Button {
                Task { await restore(customerIds: customers.map(\.id), karigarIds: karigars.map(\.id), key: "all", name: nil) }
            } label: {
                HStack(spacing: 8) {
                    if busy == "all" { ProgressView() }
                    Label("Put everything back", systemImage: "arrow.uturn.backward")
                }
            }
            .disabled(busy != nil)
            // The sheet says what goes and what it orphans before it takes the code (the page's "Empty Recently removed?").
            Button(role: .destructive) { askToEmpty(customers, karigars, h) } label: {
                Label("Empty", systemImage: "trash")
            }
            .disabled(busy != nil)
        } header: {
            Text("\(total) removed").font(.headline).foregroundStyle(.primary).textCase(nil)
        } footer: {
            Text("\(customers.count) customer(s), \(karigars.count) karigar(s). Nothing here has been destroyed. Their history is exactly where they left it.")
        }
    }

    /// The page's warning, counted out loud: what goes, and the history it leaves orphaned.
    private func emptyWarning(_ customers: [Customer], _ karigars: [Karigar], _ h: [String: RecentlyRemoved.History]) -> String {
        let t = RecentlyRemoved.removedTotals(customerIds: customers.map(\.id), karigarIds: karigars.map(\.id), history: h)
        var said = "This permanently deletes \(customers.count) customer(s) and \(karigars.count) karigar(s)."
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
            withAnimation {
                note = OwnerNote(title: "Recently removed emptied", detail: "\(c) customer(s) and \(k) karigar(s) permanently deleted.")
            }
        }
    }

    // MARK: One person

    private enum Kind { case customer, karigar }

    private func row(id: String, name: String, sub: String?, removedAt: String?, kind: Kind, history: RecentlyRemoved.History?) -> some View {
        let carries = RecentlyRemoved.carriesText(history)
        let line = [sub ?? "", carries.isEmpty ? "no history" : carries].filter { !$0.isEmpty }.joined(separator: " \u{2014} ")
        let when = ShopDate.say(removedAt)
        return HStack(spacing: 12) {
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
                if busy == id { ProgressView() } else { Text("Put back") }
            }
            .buttonStyle(.glass)
            .disabled(busy != nil)
        }
    }

    /// Put back one person, or everyone listed (the ERP restores only those still removed).
    private func restore(customerIds: [String], karigarIds: [String], key: String, name: String?) async {
        busy = key
        do {
            let out = try await ERPAPI.shared.write("restoreRemoved", ["customerIds": customerIds, "karigarIds": karigarIds])
            let back = (out["customers"] as? [Any] ?? []).count + (out["karigars"] as? [Any] ?? []).count
            withAnimation {
                if back == 0 {
                    // Someone put them back already (or they are gone): the list catches up by itself.
                    note = OwnerNote(title: "Nothing to put back", detail: "They are no longer in Recently removed.")
                } else if let name {
                    note = OwnerNote(title: "Put back", detail: "\(name.isEmpty ? "They are" : "\(name) is") in the book again.")
                } else {
                    note = OwnerNote(title: "Put everything back", detail: "\(back) record(s) restored.")
                }
            }
        } catch {
            failure = error.localizedDescription
        }
        busy = nil
    }
}
