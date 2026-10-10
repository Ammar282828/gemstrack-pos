import SwiftUI
import ERPCore

/// Merge duplicate customers (the Customers page's "Merge duplicates" dialog): the pairs that look alike (the
/// same number, or names 85% alike: CustomerDuplicates, lib/customer-duplicates.ts), each with the customer to
/// keep and the one to delete, and a manual merge for any two the list missed.
///
/// A merge moves the duplicate's invoices, orders, repairs, hisaab rows and given items to the customer kept, fills
/// in what only the duplicate knew (a number, an address), then deletes the duplicate's record for good (`mergeCustomers`, lib/writes/customer-admin.ts, as the store's). It says
/// what moves, counted from the books, before it asks for the delete code, which the ERP checks with the merge.
/// Owners only, as the web's merge is a browser write the shop floor cannot make.
struct CustomerMergeSheet: View {
    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss

    /// Nil while it looks; found in the background, as the list of a few thousand customers is about two million pairs.
    @State private var found: [CustomerDuplicates.Found]?
    /// Pairs where the person turned keep and delete round, and pairs they said were not duplicates (by `Found.id`).
    @State private var swapped: Set<String> = []
    @State private var dismissed: Set<String> = []
    @State private var keepId = ""
    @State private var duplicateId = ""
    @State private var keepSearch = ""
    @State private var duplicateSearch = ""
    @State private var deletion: OwnerDeletion?
    @State private var note: OwnerNote?
    @State private var counted = Memo<CustomerMergeBook>()

    private var ready: Bool {
        book.customers.loaded && book.invoices.loaded && book.orders.loaded && book.hisaab.loaded && book.givenItems.loaded && book.repairs.loaded
    }

    private var failure: String? {
        book.customers.error ?? book.invoices.error ?? book.orders.error ?? book.hisaab.error ?? book.givenItems.error ?? book.repairs.error
    }

    /// The live book, as the web's `customers` (a removed customer is not in it).
    private var live: [Customer] { book.customers.items.filter { !CustomerKit.isRemoved($0) } }

    var body: some View {
        NavigationStack {
            ShelfState(loaded: ready, error: failure, offline: book.customers.offline) {
                list
            }
            .navigationTitle("Merge duplicates")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
        }
        .ownerNote($note)
        .task {
            book.customers.need()
            book.invoices.need()
            book.orders.need()
            book.hisaab.need()
            book.givenItems.need()
            book.repairs.need()
        }
        .task(id: book.customers.revision) { await look() }
    }

    /// The pairs again whenever the customers change (a merge takes one away).
    private func look() async {
        guard book.customers.loaded else { return }
        let people = live.map { CustomerDuplicates.Candidate(id: $0.id, name: $0.name, phone: $0.phone ?? "") }
        let result = await Task.detached(priority: .userInitiated) { () -> [CustomerDuplicates.Found] in
            CustomerDuplicates.detect(people)
        }.value
        found = result
    }

    private func moves(for id: String) -> CustomerMergeCounts {
        let key = [book.invoices.revision, book.orders.revision, book.hisaab.revision, book.givenItems.revision, book.repairs.revision]
        let counts = counted(key) {
            CustomerMergeBook(invoices: book.invoices.items, orders: book.orders.items, hisaab: book.hisaab.items, given: book.givenItems.items, repairs: book.repairs.items)
        }
        return counts.counts(id)
    }

    // MARK: The page

    private var list: some View {
        let byId = Dictionary(live.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let visible = (found ?? []).filter { !dismissed.contains($0.id) && byId[$0.a] != nil && byId[$0.b] != nil }
        return List { Group {
            if found == nil {
                Section {
                    HStack(spacing: 10) {
                        SkeletonLoading()
                        Text("Looking for duplicates…").foregroundStyle(.secondary)
                    }
                }
            } else if visible.isEmpty {
                Section {
                    Text("No duplicates auto-detected.").foregroundStyle(.secondary)
                } footer: {
                    Text("Customers who share a number, or whose names are almost the same, show up here.")
                }
            } else {
                ForEach(visible) { (pair: CustomerDuplicates.Found) in
                    pairSection(pair, byId)
                }
            }
            manualSection(byId)
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: A pair the list found

    @ViewBuilder
    private func pairSection(_ pair: CustomerDuplicates.Found, _ byId: [String: Customer]) -> some View {
        let turned = swapped.contains(pair.id)
        if let keep = byId[turned ? pair.b : pair.a], let duplicate = byId[turned ? pair.a : pair.b] {
            Section {
                person("Keep", keep, tint: Theme.accent)
                person("Delete", duplicate, tint: .red, moves: moves(for: duplicate.id))
                Button { toggle(pair.id) } label: {
                    Label("Swap keep and delete", systemImage: "arrow.up.arrow.down")
                }
                Button(role: .destructive) { ask(keep: keep, duplicate: duplicate) } label: {
                    Label("Merge and delete the duplicate", systemImage: "arrow.triangle.merge")
                }
                Button { dismissed.insert(pair.id) } label: {
                    Label("Not a duplicate", systemImage: "xmark")
                }
            } header: {
                Text(pair.reason).textCase(nil)
            }
        }
    }

    private func toggle(_ id: String) {
        if swapped.contains(id) { swapped.remove(id) } else { swapped.insert(id) }
    }

    private func person(_ role: String, _ c: Customer, tint: Color, moves: CustomerMergeCounts? = nil) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(role.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(tint)
            Text(CustomerKit.shown(c)).font(.body.weight(.medium))
            if let phone = CustomerKit.filled(c.phone) {
                Text(phone).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            if let moves {
                Text(moves.total == 0 ? "No invoices, orders, repairs or hisaab to move." : "Moves \(moves.sentence) to the customer kept.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Two the list missed

    private func manualSection(_ byId: [String: Customer]) -> some View {
        let keep = byId[keepId]
        let duplicate = byId[duplicateId]
        return Section {
            chooser("Keep (primary)", picked: keep, tint: Theme.accent, search: $keepSearch, other: duplicateId) { keepId = $0 }
            chooser("Duplicate (will be deleted)", picked: duplicate, tint: .red, search: $duplicateSearch, other: keepId) { duplicateId = $0 }
            if let keep, let duplicate {
                Text(duplicateMoves(duplicate, keep))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Button(role: .destructive) {
                if let keep, let duplicate { ask(keep: keep, duplicate: duplicate) }
            } label: {
                Label("Merge and delete the duplicate", systemImage: "arrow.triangle.merge")
            }
            .disabled(keep == nil || duplicate == nil || keepId == duplicateId)
        } header: {
            LedgerHeading(title: "Manual merge")
        } footer: {
            Text("Search the customer to keep, then the duplicate. The duplicate's record is deleted for good.")
        }
    }

    private func duplicateMoves(_ duplicate: Customer, _ keep: Customer) -> String {
        let counts = moves(for: duplicate.id)
        return counts.total == 0
            ? "\(CustomerKit.shown(duplicate)) has no invoices, orders, repairs or hisaab to move."
            : "Moves \(counts.sentence) from \(CustomerKit.shown(duplicate)) to \(CustomerKit.shown(keep))."
    }

    /// Who is picked, or a search box with the people who match (the web's two boxes: two letters at least, six shown).
    @ViewBuilder
    private func chooser(_ title: String, picked: Customer?, tint: Color, search: Binding<String>, other: String,
                         choose: @escaping (String) -> Void) -> some View {
        if let c = picked {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.caption.weight(.semibold)).foregroundStyle(tint)
                    Text(CustomerKit.shown(c)).font(.body.weight(.medium))
                    if let phone = CustomerKit.filled(c.phone) {
                        Text(phone).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                Spacer(minLength: 8)
                Button("Clear") {
                    choose("")
                    search.wrappedValue = ""
                }
                .buttonStyle(.borderless)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(tint)
                TextField(title, text: search, prompt: Text("Search by name or phone"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            ForEach(matches(search.wrappedValue, excluding: other)) { (c: Customer) in
                Button {
                    choose(c.id)
                    search.wrappedValue = ""
                } label: {
                    TwoLine(title: CustomerKit.shown(c), subtitle: CustomerKit.filled(c.phone))
                        .foregroundStyle(.primary)
                }
            }
        }
    }

    private func matches(_ typed: String, excluding other: String) -> [Customer] {
        let q = CustomerKit.trim(typed)
        guard q.count > 1 else { return [] }
        let lower = q.lowercased()
        return Array(live.filter { c in
            c.id != other && (c.name.lowercased().contains(lower) || (c.phone ?? "").contains(q))
        }.prefix(6))
    }

    // MARK: Asking, then merging

    /// Says what moves before it asks for the code; the delete code is the web's `Merge, and delete customer <name>`.
    private func ask(keep: Customer, duplicate: Customer) {
        let counts = moves(for: duplicate.id)
        let gone = CustomerKit.shown(duplicate)
        let kept = CustomerKit.shown(keep)
        let detail = counts.total == 0
            ? "\(gone) has no invoices, orders, repairs or hisaab, so only their record is deleted. \(kept) stays."
            : "\(gone)'s \(counts.sentence) move to \(kept), and \(gone)'s record is deleted for good."
        deletion = OwnerDeletion(what: "Merge, and delete customer \(gone)", detail: detail) { code in
            let out = try await ERPAPI.shared.write("mergeCustomers", ["keepId": keep.id, "deleteId": duplicate.id, "deleteCode": code])
            let moved = out["updatedDocs"] as? Int ?? 0
            withAnimation {
                note = OwnerNote(title: "Customers merged", detail: "\(gone) is gone. \(moved) record\(moved == 1 ? "" : "s") updated.")
            }
            if keepId == keep.id || duplicateId == duplicate.id {
                keepId = ""
                duplicateId = ""
            }
        }
    }
}
