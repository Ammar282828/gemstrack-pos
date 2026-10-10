import SwiftUI
import ERPCore

/// Repairs (src/app/repairs/page.tsx, docs/decisions.md "Repairs"): a customer's own pieces, left to be
/// mended. The list by where the ticket stands, In the shop then Ready, with Collected and Cancelled
/// folded away; a ticket opens as a sheet. Owners take pieces in and move them on (Ready, Collected,
/// money): the ERP lets only an owner write a repair, and staff read the list as it is.
///
/// The ERP links here as /repairs?id=REP-000001 (open that ticket) and /repairs?new=1 (the form).
/// Read once, when the screen appears and, for an id, once the list is in.
struct RepairsScreen: View {
    /// The whole path, query and all (the registry's `exact` would have dropped the query).
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL

    @State private var query = ""
    /// The folded groups a person has opened.
    @State private var opened: Set<String> = []
    @State private var desk = RepairsDesk()
    @State private var sheet: RepairsOpen?
    @State private var creating = false
    /// A repair just written: its sheet opens when the form has left.
    @State private var pending: RepairsOpen?
    @State private var linkRead = false
    @State private var missing: String?

    var body: some View {
        ShelfState(loaded: book.repairs.loaded, error: book.repairs.error, offline: book.repairs.offline) {
            list
        }
        .navigationTitle("Repairs")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Name, phone, piece or REP no.")
        .toolbar { newRepairButton }
        .sheet(item: $sheet) { open in RepairsSheet(id: open.id, seed: open.seed) }
        .sheet(isPresented: $creating, onDismiss: openPending) {
            RepairsForm { id, seed in pending = RepairsOpen(id: id, seed: seed) }
        }
        .repairsDesk(desk)
        .alert("Repair not found", isPresented: missingShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("\(missing ?? "That ticket") may have been deleted.")
        }
        .onAppear {
            book.repairs.need()
            readLink()
        }
        .onChange(of: book.repairs.loaded) { _, _ in readLink() }
    }

    // MARK: Deep links

    /// /repairs?new=1 opens the form (for an owner); /repairs?id=REP-000012 opens that ticket once the
    /// list has come in, or says so if it is not there.
    private func readLink() {
        if linkRead { return }
        let items = URLComponents(string: path)?.queryItems ?? []
        let isNew = items.contains { $0.name == "new" && $0.value == "1" }
        let id = items.first { $0.name == "id" }?.value ?? ""
        if isNew {
            linkRead = true
            if session.isOwner { creating = true }
        } else if !id.isEmpty {
            if !book.repairs.loaded { return }
            linkRead = true
            if book.repairs.item(id) != nil { sheet = RepairsOpen(id: id, seed: nil) } else { missing = id }
        } else {
            linkRead = true
        }
    }

    private func openPending() {
        if let p = pending {
            pending = nil
            sheet = p
        }
    }

    private var missingShown: Binding<Bool> {
        Binding(get: { missing != nil }, set: { if !$0 { missing = nil } })
    }

    // MARK: The list

    @ViewBuilder
    private var list: some View {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let all = book.repairs.items
        let shown = q.isEmpty ? all : all.filter { RepairsKit.matches($0, q) }
        let groups = RepairsKit.groups(shown)
        let now = Date()
        List { Group {
            ForEach(groups) { g in
                groupSection(g, now: now, forceOpen: !q.isEmpty)
            }
            }
            .houseRows()
        }
        .listStyle(.insetGrouped)
        .overlay {
            if groups.isEmpty { emptyState(searching: !q.isEmpty) }
        }
    }

    @ViewBuilder
    private func emptyState(searching: Bool) -> some View {
        if searching {
            ContentUnavailableView.search(text: query)
        } else {
            ContentUnavailableView(
                "No repairs yet",
                systemImage: "wrench.and.screwdriver",
                description: Text(session.isOwner ? "Tap + when a customer leaves pieces to be mended." : "Repairs the shop takes in will show here.")
            )
        }
    }

    @ViewBuilder
    private func groupSection(_ g: RepairsGroup, now: Date, forceOpen: Bool) -> some View {
        Section {
            if g.folded {
                DisclosureGroup(isExpanded: expansion(g.id, forceOpen: forceOpen)) {
                    rows(g.rows, now: now)
                } label: {
                    Text("\(g.rows.count) repair\(g.rows.count == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                }
            } else {
                rows(g.rows, now: now)
            }
        } header: {
            groupHeader(g)
        }
    }

    private func groupHeader(_ g: RepairsGroup) -> some View {
        let owing = g.folded ? 0 : g.rows.reduce(0.0) { (sum: Double, r: Repair) -> Double in sum + RepairsKit.repairBalance(r) }
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(g.title)
                .font(.subheadline.weight(.semibold))
            Spacer(minLength: 8)
            Text("\(g.rows.count)")
                .font(.caption)
                .foregroundStyle(.secondary)
            if owing > 0 {
                HStack(spacing: 4) {
                    MoneyText(amount: owing)
                    Text("due")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .textCase(nil)
    }

    private func expansion(_ id: String, forceOpen: Bool) -> Binding<Bool> {
        Binding(
            get: { forceOpen || opened.contains(id) },
            set: { open in
                if open { opened.insert(id) } else { opened.remove(id) }
            }
        )
    }

    @ViewBuilder
    private func rows(_ repairs: [Repair], now: Date) -> some View {
        ForEach(repairs) { r in
            row(r, now: now)
        }
    }

    private func row(_ r: Repair, now: Date) -> some View {
        Button {
            sheet = RepairsOpen(id: r.id, seed: nil)
        } label: {
            RepairsRow(repair: r, now: now, busy: desk.isBusy(r.id))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) { trailingSwipe(r) }
        .swipeActions(edge: .leading, allowsFullSwipe: false) { leadingSwipe(r) }
        .contextMenu { menu(r) }
    }

    // MARK: Row actions (owners write; everyone can tell the customer)

    @ViewBuilder
    private func trailingSwipe(_ r: Repair) -> some View {
        if session.isOwner && r.status == .received {
            Button { desk.markReady(r) } label: { Label("Mark ready", systemImage: "checkmark.circle") }
                .tint(.green)
        }
        if session.isOwner && r.status == .ready {
            Button { desk.collect(r) } label: { Label("Collected", systemImage: "shippingbox") }
                .tint(.indigo)
        }
    }

    @ViewBuilder
    private func leadingSwipe(_ r: Repair) -> some View {
        if r.status == .ready, let url = RepairsKit.whatsAppURL(for: r, shopName: session.shop.name) {
            Button { openURL(url) } label: { Label("Tell them", systemImage: "message") }
                .tint(.green)
        }
    }

    @ViewBuilder
    private func menu(_ r: Repair) -> some View {
        if session.isOwner && r.status == .received {
            Button { desk.markReady(r) } label: { Label("Mark ready", systemImage: "checkmark.circle") }
        }
        if session.isOwner && r.status == .ready {
            Button { desk.collect(r) } label: { Label("Collected", systemImage: "shippingbox") }
        }
        if r.status == .ready, let url = RepairsKit.whatsAppURL(for: r, shopName: session.shop.name) {
            Button { openURL(url) } label: { Label("Tell them it's ready", systemImage: "message") }
        }
        if session.isOwner && r.status != .cancelled && RepairsKit.repairBalance(r) > 0 {
            Button { desk.taking = r } label: { Label("Take payment", systemImage: "creditcard") }
        }
        if session.isOwner && (r.status == .received || r.status == .ready) {
            Button(role: .destructive) { desk.askCancel(r) } label: { Label("Cancel repair", systemImage: "xmark.circle") }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var newRepairButton: some ToolbarContent {
        if session.isOwner {
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label("New repair", systemImage: "plus") }
            }
        }
    }
}

/// A ticket on the list: what it is, who for, when it was promised (late in red), what it still owes,
/// and the karigar if it is with one.
struct RepairsRow: View {
    let repair: Repair
    let now: Date
    let busy: Bool

    private var greyed: Bool { repair.status == .collected || repair.status == .cancelled }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(RepairsKit.repairSummary(repair))
                    .font(.headline)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if busy { SkeletonLoading() } else { money }
            }
            Text(who)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            RepairsPromiseText(repair: repair, now: now)
            Text(facts)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .opacity(greyed ? 0.55 : 1)
        .padding(.vertical, 2)
    }

    /// "Hira Sample · +923000000103".
    private var who: String {
        var s = RepairsKit.customer(repair)
        if let phone = RepairsKit.filled(repair.customerContact) { s += " · " + phone }
        return s
    }

    /// "REP-000012 · in Tue 6 Oct · with Ustad Demo".
    private var facts: String {
        var parts: [String] = [repair.id]
        switch repair.status {
        case .ready:
            if let d = RepairsKit.filled(repair.readyAt) { parts.append("ready " + RepairsKit.byDay(d)) }
        case .collected:
            if let d = RepairsKit.filled(repair.collectedAt) { parts.append("collected " + RepairsKit.byDay(d)) }
        default:
            parts.append("in " + RepairsKit.byDay(repair.receivedAt))
        }
        if let k = RepairsKit.filled(repair.karigarName) { parts.append("with " + k) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var money: some View {
        let owing = RepairsKit.repairBalance(repair)
        if owing > 0 {
            VStack(alignment: .trailing, spacing: 0) {
                MoneyText(amount: owing, exact: true)
                    .font(.subheadline.weight(.semibold))
                Text("due")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } else if RepairsKit.repairTotal(repair) > 0 {
            Text("paid")
                .font(.caption)
                .foregroundStyle(.green)
        }
    }
}
