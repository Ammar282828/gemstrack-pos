import SwiftUI
import ERPCore

/// Hisaab → Add entry (src/app/hisaab/page.tsx `AddNewHisaabDialog`, "Add or choose an account"): the customers and
/// karigars on file to search, and a ledger opens for the one picked, where "You gave" and "You got" write the row.
/// A name typed that is on nobody's file can become a new karigar from here (`addKarigar`, as the web does), and
/// opens his ledger; a new customer, or a karigar with his number and specialty, goes to the form for one.
struct HisaabAccountPicker: View {
    /// Where to go next: a person's ledger, or the form for a new one. Told as the sheet closes.
    let go: (Route) -> Void

    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var creating = false
    @State private var failure: String?

    private struct Contact: Identifiable {
        let id: String
        let name: String
        let isCustomer: Bool
    }

    /// Customers and karigars, A to Z; a removed one is not on the web's list either.
    private var contacts: [Contact] {
        var out: [Contact] = []
        for c in book.customers.items where !CustomerKit.isRemoved(c) {
            out.append(Contact(id: c.id, name: c.name, isCustomer: true))
        }
        for k in book.karigars.items where (k.deletedAt ?? "").isEmpty {
            out.append(Contact(id: k.id, name: k.name, isCustomer: false))
        }
        return out.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var typed: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            ShelfState(loaded: book.customers.loaded && book.karigars.loaded,
                       error: book.customers.error ?? book.karigars.error, offline: book.customers.offline) {
                list
            }
            .navigationTitle("Add or choose an account")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $search, prompt: "Search by name, or type a new karigar")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(creating)
        .alert("Could not add the karigar", isPresented: failureShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
        .task {
            book.customers.need()
            book.karigars.need()
        }
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
    }

    private var list: some View {
        let all = contacts
        let shown = typed.isEmpty ? all : all.filter { $0.name.localizedCaseInsensitiveContains(typed) }
        // The web offers a new karigar for a name nobody on file has.
        let exactOnFile = !typed.isEmpty && all.contains { $0.name.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(typed) == .orderedSame }
        let canCreate = !typed.isEmpty && !exactOnFile && !creating
        return List { Group {
            Section {
                if shown.isEmpty && !canCreate && !creating {
                    Text("No contacts found. Add a new one below.").foregroundStyle(.secondary)
                }
                ForEach(shown) { (c: Contact) in
                    Button { pick(c) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: c.isCustomer ? "person.fill" : "briefcase.fill")
                                .foregroundStyle(Theme.accent)
                                .frame(width: 32, height: 32)
                                .background(Theme.accent.opacity(0.14), in: .circle)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.name.isEmpty ? c.id : c.name).font(.body.weight(.medium)).lineLimit(1)
                                Text(c.isCustomer ? "Customer" : "Karigar").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(.primary)
                    }
                }
                if canCreate || creating {
                    Button { Task { await createKarigar() } } label: {
                        HStack(spacing: 12) {
                            if creating { SkeletonLoading() } else { Image(systemName: "plus.circle") }
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(creating ? "Adding" : "Add karigar") \u{201C}\(typed)\u{201D}").font(.body.weight(.medium))
                                Text("Opens a new hisaab for him").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(.primary)
                    }
                    .disabled(creating)
                }
            }
            Section {
                Button { open("/customers/add") } label: { Label("New customer", systemImage: "person.badge.plus") }
                Button { open("/karigars/add") } label: { Label("New karigar", systemImage: "briefcase") }
            } footer: {
                Text("A new customer or karigar is added with the full form.")
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.interactively)
        .disabled(creating)
    }

    private func pick(_ c: Contact) {
        go(Route(path: MoneyPaths.ledger(c.id, isCustomer: c.isCustomer)))
        dismiss()
    }

    private func open(_ path: String) {
        go(Route(path: path))
        dismiss()
    }

    /// A typed name that is on nobody's file becomes a karigar with that name alone and opens his ledger.
    @MainActor
    private func createKarigar() async {
        let name = typed
        guard !name.isEmpty, !creating else { return }
        creating = true
        do {
            let out = try await ERPAPI.shared.write("addKarigar", ["karigar": ["name": name]])
            let made: [String: Any] = out["karigar"] as? [String: Any] ?? [:]
            let id: String = made["id"] as? String ?? ""
            if id.isEmpty {
                failure = "Nothing was saved. Try again."
            } else {
                go(Route(path: MoneyPaths.ledger(id, isCustomer: false)))
                dismiss()
            }
        } catch {
            failure = error.localizedDescription
        }
        creating = false
    }
}
