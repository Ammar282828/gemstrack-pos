import SwiftUI
import ERPCore

/// Clean up spam (the Customers page's "Review Spam Accounts" dialog): bot sign-ups, found by the ERP's own rules
/// (`CustomerSpam`, lib/customer-spam.ts): a gibberish name or a random email, and no phone, no address and no
/// order, invoice or hisaab row at all, so a real customer who merely lacks a number is never offered.
///
/// Everyone flagged starts ticked, as on the web; untick whoever to keep. The delete code is asked once: the first
/// removal is sent with it from the code sheet (so a wrong code is said there), and the rest follow with the same
/// code, one `removeCustomer` each (lib/writes/customer-admin.ts), with the count as they go and what was not
/// removed, and why, at the end. Removing hides a customer; Settings, then Recently removed, puts them back.
/// Owners only, as the web's removal is a browser write the shop floor cannot make, and only owners read the hisaab
/// this checks.
struct CustomerSpamSheet: View {
    @Environment(Book.self) private var book
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Nil while it looks.
    @State private var found: [CustomerSpam.Candidate]?
    /// Who is ticked (customer ids), and everyone the list has offered so far: a newly flagged one starts ticked.
    @State private var selected: Set<String> = []
    @State private var offered: Set<String> = []
    @State private var deletion: OwnerDeletion?
    @State private var run: Run?
    @State private var note: Note?
    @State private var confirmingDelete = false

    /// One clean-up: who is to go, in the list's order, how far it has got, and what came of each.
    private struct Run {
        let queue: [CustomerSpam.Candidate]
        /// The code the first removal proved; the rest are sent with it.
        var code: String?
        /// The next one to send.
        var next = 0
        var removed: [String] = []
        var failed: [(name: String, why: String)] = []
        var finished = false

        var done: Int { removed.count + failed.count }
    }

    private var ready: Bool {
        book.customers.loaded && book.invoices.loaded && book.orders.loaded && book.hisaab.loaded
    }

    private var failure: String? {
        book.customers.error ?? book.invoices.error ?? book.orders.error ?? book.hisaab.error
    }

    /// Re-looked whenever the books move, but never under a clean-up that is running or being summed up.
    private var booksRevision: [Int] {
        [book.customers.revision, book.invoices.revision, book.orders.revision, book.hisaab.revision]
    }

    var body: some View {
        NavigationStack {
            ShelfState(loaded: ready, error: failure, offline: book.customers.offline) {
                #if os(macOS)
                macList
                #else
                list
                #endif
            }
            .navigationTitle("Clean up spam")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if run?.finished == true {
                        Button("Done") { dismiss() }
                    } else {
                        Button(role: .cancel) { dismiss() }
                            .disabled(working)
                    }
                }
            }
        }
        .interactiveDismissDisabled(working)
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {
                Task { await removeTheRest() }
            }
            .presentationSizing(.form)
        }
        .noteToast($note)
        .destructiveFeedback(trigger: run?.removed.count ?? 0)
        .task {
            book.customers.need()
            book.invoices.need()
            book.orders.need()
            book.hisaab.need()
        }
        .task(id: booksRevision) { await look() }
    }

    private var working: Bool { run != nil && run?.finished == false }

    /// The flagged again whenever the books change, as the web's list follows its store.
    private func look() async {
        guard ready, run == nil else { return }
        // The live book, as the web's `customers` (a removed customer is not in it).
        let people = book.customers.items.filter { !CustomerKit.isRemoved($0) }
        let orders = book.orders.items, invoices = book.invoices.items, hisaab = book.hisaab.items
        let result = await Task.detached(priority: .userInitiated) { () -> [CustomerSpam.Candidate] in
            let transacted = CustomerSpam.transactedIds(orders: orders, invoices: invoices, hisaab: hisaab)
            return CustomerSpam.detect(people, transacted: transacted)
        }.value
        guard run == nil else { return }
        let ids = Set(result.map(\.id))
        selected = selected.intersection(ids).union(ids.subtracting(offered))
        offered.formUnion(ids)
        found = result
    }

    // MARK: The list

    private var list: some View {
        List {
            Group {
                if let run {
                    progressSection(run)
                    if run.finished { summarySections(run) }
                } else if let found {
                    if found.isEmpty {
                        Section {
                            Label("No spam accounts found", systemImage: "checkmark.circle")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        candidatesSection(found)
                    }
                } else {
                    Section {
                        HStack(spacing: pt(10)) {
                            ProgressView()
                            Text("Looking for spam…").foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .modifier(DeleteBar(show: run == nil && !(found ?? []).isEmpty,
                            count: (found ?? []).filter { selected.contains($0.id) }.count) {
            confirmingDelete = true
        })
        .confirmDestructive(isPresented: $confirmingDelete,
                            title: "Delete the selected accounts?",
                            message: "Removing hides them; Settings, then Recently removed, puts them back. It asks for the delete code once.",
                            action: "Continue") {
            ask((found ?? []).filter { selected.contains($0.id) })
        }
        .selectionFeedback(trigger: selected)
    }

    /// The sheet's one action, pinned under the long list, with the count in its words.
    private struct DeleteBar: ViewModifier {
        let show: Bool
        let count: Int
        let delete: () -> Void
        func body(content: Content) -> some View {
            if show {
                content.actionBar(primary: ActionBar.Action(count == 1 ? "Delete 1 selected" : "Delete \(count) selected",
                                                            systemImage: "trash", role: .destructive,
                                                            isDisabled: count == 0, action: delete))
            } else {
                content
            }
        }
    }

    private func candidatesSection(_ found: [CustomerSpam.Candidate]) -> some View {
        let all = selected.count == found.count
        return Section {
            Button {
                selected = all ? [] : Set(found.map(\.id))
            } label: {
                tick(all, "Select all (\(selected.count)/\(found.count))")
            }
            ForEach(found) { (c: CustomerSpam.Candidate) in
                row(c)
            }
        } header: {
            LedgerHeading(title: "Suspected bot accounts", count: found.count)
        } footer: {
            VStack(alignment: .leading, spacing: pt(6)) {
                Text("Removing hides them; Settings, then Recently removed, puts them back. It asks for the delete code once.")
                // The web's own warning: a storefront's bots sign up again until the store stops them.
                if found.contains(where: { CustomerKit.filled($0.customer.shopifyCustomerId) != nil }) {
                    Text("Rows tagged Shopify came from the Shopify store. Removing them here hides them in the ERP; if the storefront spam goes on they may sync back. A sign-up CAPTCHA in Shopify stops the source.")
                        .foregroundStyle(Tone.owed.color)
                }
            }
        }
    }

    private func row(_ c: CustomerSpam.Candidate) -> some View {
        let on = selected.contains(c.id)
        return Button {
            if on { selected.remove(c.id) } else { selected.insert(c.id) }
        } label: {
            HStack(alignment: .top, spacing: pt(12)) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(on ? Theme.accent : Color.secondary)
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: pt(4)) {
                    Text(CustomerKit.trim(c.customer.name).isEmpty ? "(no name)" : c.customer.name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.primary)
                    Text(CustomerKit.filled(c.customer.email) ?? "no email")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // The reasons are one quiet line (they wrap, never cut); only Shopify is a mark.
                    Text(c.reasons.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if CustomerKit.filled(c.customer.shopifyCustomerId) != nil {
                        Pill("Shopify", tone: .working)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func tick(_ on: Bool, _ title: String) -> some View {
        HStack(spacing: pt(12)) {
            Image(systemName: on ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(on ? Theme.accent : Color.secondary)
                .contentTransition(.symbolEffect(.replace))
            Text(title).foregroundStyle(.primary)
        }
    }

    // MARK: Removing

    /// Says what happens, then asks for the code once.
    private func ask(_ picked: [CustomerSpam.Candidate]) {
        guard !picked.isEmpty else { return }
        let n = picked.count
        let what = n == 1 ? "Delete customer \(CustomerKit.shown(picked[0].customer))" : "Delete \(n) spam customers"
        let detail = (n == 1 ? "They will be hidden from the lists." : "All \(n) will be hidden from the lists.")
            + " Settings, then Recently removed, puts them back."
        deletion = OwnerDeletion(what: what, detail: detail, final: false) { code in
            try await removeFirst(picked, code: code)
        }
    }

    /// The first removal, from the code sheet: until one goes through, a refused code is the sheet's to say. One that
    /// cannot be removed for its own sake (already removed elsewhere) is noted and the next is tried.
    private func removeFirst(_ queue: [CustomerSpam.Candidate], code: String) async throws {
        var r = Run(queue: queue)
        run = r
        while r.next < queue.count {
            let c = queue[r.next]
            do {
                try await remove(c, code: code)
                r.removed.append(CustomerKit.shown(c.customer))
                r.code = code
                r.next += 1
                run = r
                return
            } catch let f as ERPAPI.Failure where Self.isAboutTheCode(f) {
                // Nothing went: the sheet says why and the list comes back as it was.
                run = nil
                throw f
            } catch let f as ERPAPI.Failure where f.status == 409 || f.status == 400 {
                r.failed.append((CustomerKit.shown(c.customer), f.message))
                r.next += 1
                run = r
            } catch {
                run = nil
                throw error
            }
        }
        // None could be removed, so the code was never put to the test: what happened is said all the same.
        r.finished = true
        run = r
    }

    /// The rest, with the code the first one proved, after the code sheet has closed.
    private func removeTheRest() async {
        guard var r = run, let code = r.code else {
            if run != nil { finish() }
            return
        }
        while r.next < r.queue.count {
            let c = r.queue[r.next]
            do {
                try await remove(c, code: code)
                r.removed.append(CustomerKit.shown(c.customer))
            } catch {
                r.failed.append((CustomerKit.shown(c.customer), error.localizedDescription))
            }
            r.next += 1
            run = r
        }
        finish()
    }

    private func remove(_ c: CustomerSpam.Candidate, code: String) async throws {
        _ = try await ERPAPI.shared.write("removeCustomer", ["customerId": c.id, "deleteCode": code])
    }

    private func finish() {
        guard var r = run else { return }
        r.finished = true
        run = r
        let gone = r.removed.count
        Note.show(Note(title: gone == 1 ? "1 customer removed" : "\(gone) customers removed",
                       detail: r.failed.isEmpty ? "Settings, then Recently removed, puts them back." : "\(r.failed.count) not removed.",
                       failed: gone == 0),
                  in: $note, reduce: reduceMotion)
    }

    /// A refusal of the code itself (none typed, wrong, too many tries, none set for the shop), as delete-code-gate.ts words them.
    private static func isAboutTheCode(_ f: ERPAPI.Failure) -> Bool {
        f.status == 403 || f.status == 429 || f.status == 503 || (f.status == 400 && f.message.localizedCaseInsensitiveContains("delete code"))
    }

    // MARK: How it went

    private func progressSection(_ r: Run) -> some View {
        Section {
            VStack(alignment: .leading, spacing: pt(8)) {
                Text(r.finished ? "Finished" : "Removing \(min(r.done + 1, r.queue.count)) of \(r.queue.count)…")
                    .font(.body.weight(.medium))
                ProgressView(value: Double(r.done), total: Double(max(1, r.queue.count)))
                    .tint(Theme.accent)
                Text("\(r.removed.count) removed" + (r.failed.isEmpty ? "" : ", \(r.failed.count) not removed"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .padding(.vertical, pt(4))
        } header: {
            LedgerHeading(title: "Clean-up")
        } footer: {
            if !r.finished { Text("Keep this open until it finishes.") }
        }
    }

    @ViewBuilder
    private func summarySections(_ r: Run) -> some View {
        if !r.failed.isEmpty {
            Section {
                ForEach(r.failed.indices, id: \.self) { (i: Int) in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(r.failed[i].name).font(.body.weight(.medium))
                        Text(r.failed[i].why).font(.caption).foregroundStyle(Tone.problem.color)
                    }
                }
            } header: {
                LedgerHeading(title: "Not removed", count: r.failed.count, tone: .problem)
            }
        }
        if !r.removed.isEmpty {
            Section {
                ForEach(r.removed.indices, id: \.self) { (i: Int) in
                    Label(r.removed[i], systemImage: "person.badge.minus")
                }
            } header: {
                LedgerHeading(title: "Removed", count: r.removed.count)
            }
        }
        Section {
            Button {
                run = nil
                found = nil
                Task { await look() }
            } label: {
                Label("Look again", systemImage: "arrow.clockwise")
            }
        }
    }
}

#if os(macOS)

// MARK: - The Mac table

/// The flagged accounts as a table you select in: every row starts selected (as the web's ticks do), click or shift-click
/// to keep someone out, ⌘A for all. The delete code is asked once, as ever; the run's progress and summary are the page's.
extension CustomerSpamSheet {
    @ViewBuilder
    private var macList: some View {
        Group {
            if let run {
                Form {
                    progressSection(run)
                    if run.finished { summarySections(run) }
                }
                .formStyle(.grouped)
                .scrollContentBackground(.hidden)
            } else if let found {
                if found.isEmpty {
                    ContentUnavailableView("No spam accounts found", systemImage: "checkmark.circle")
                } else {
                    macTable(found)
                }
            } else {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Looking for spam\u{2026}").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 560, idealWidth: 800, minHeight: 480, idealHeight: 600)
        .background(Theme.ground)
        .modifier(DeleteBar(show: run == nil && !(found ?? []).isEmpty,
                            count: (found ?? []).filter { selected.contains($0.id) }.count) {
            confirmingDelete = true
        })
        .confirmDestructive(isPresented: $confirmingDelete,
                            title: "Delete the selected accounts?",
                            message: "Removing hides them; Settings, then Recently removed, puts them back. It asks for the delete code once.",
                            action: "Continue") {
            ask((found ?? []).filter { selected.contains($0.id) })
        }
        .toolbar {
            if run == nil, let found, !found.isEmpty {
                ToolbarItemGroup(placement: .automatic) {
                    Button { selected = Set(found.map(\.id)) } label: { Label("Select all", systemImage: "checkmark.circle") }
                        .help("Select every flagged account")
                    Button { selected = [] } label: { Label("Select none", systemImage: "circle") }
                        .help("Keep everyone: select no one")
                }
            }
        }
    }

    private func macTable(_ found: [CustomerSpam.Candidate]) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("\(selected.count) of \(found.count) selected to remove")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Spacer(minLength: 0)
                if found.contains(where: { CustomerKit.filled($0.customer.shopifyCustomerId) != nil }) {
                    Text("Rows tagged Shopify may sync back until the storefront's sign-up has a CAPTCHA.")
                        .font(.footnote)
                        .foregroundStyle(Tone.owed.color)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            Divider()
            Table(found, selection: $selected) {
                TableColumn("Name") { (c: CustomerSpam.Candidate) in
                    Text(CustomerKit.trim(c.customer.name).isEmpty ? "(no name)" : c.customer.name)
                }
                .width(min: 120, ideal: 180)
                TableColumn("Email") { (c: CustomerSpam.Candidate) in
                    Text(CustomerKit.filled(c.customer.email) ?? "no email").foregroundStyle(.secondary)
                }
                .width(min: 120, ideal: 240)
                TableColumn("Why it was flagged") { (c: CustomerSpam.Candidate) in
                    Text(c.reasons.joined(separator: " \u{00B7} ")).foregroundStyle(.secondary).lineLimit(1)
                }
                .width(min: 100, ideal: 260)
                TableColumn("From") { (c: CustomerSpam.Candidate) in
                    if CustomerKit.filled(c.customer.shopifyCustomerId) != nil { MacStatus("Shopify", tone: .working) }
                }
                .width(min: 80, ideal: 90)
            }
            .contextMenu(forSelectionType: String.self) { ids in
                if let id = ids.first, let c = found.first(where: { $0.id == id }), let email = CustomerKit.filled(c.customer.email) {
                    Button("Copy email") { UIPasteboard.general.string = email }
                }
            }
            .selectionFeedback(trigger: selected)
        }
    }
}
#endif
