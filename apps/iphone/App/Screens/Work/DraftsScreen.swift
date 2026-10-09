import SwiftUI
import ERPCore

/// Drafts (src/app/drafts/page.tsx, docs/decisions.md "Drafts"): orders and sales started and not yet saved, on every
/// device, newest typed first, each with who it is for, what is in it, the running total, and when and where it was
/// last typed. Continue opens it; Discard removes it (after asking: the web has an Undo, the phone asks first).
///
/// Owners read Firestore `drafts` live, as the web does. Staff have no Firestore (firestore.rules) and the server has no
/// list of drafts for them, so they see what is kept on this phone, which is their own order in progress.
///
/// A draft this phone wrote (WorkDraftSync) is continued in the native form, which holds that work already
/// (NewOrderDraftStore, SaleDraftStore). One begun on the web or on another phone opens in the ERP's own form inside the
/// app (`/orders/add?draft=<id>&web=1`): the phone has no way to read the web's form values back into its own.
struct DraftsScreen: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session

    /// Firestore `drafts`, read as cards (the form's own values are left alone: a draft with photos weighs a megabyte).
    @State private var shelf = Shelf<WorkDraft>("drafts") { $0.updatedAt > $1.updatedAt }
    /// What this phone holds of its own, read when the screen opens (the photos left out: they change no figure).
    @State private var phoneOrder: NewOrderDraft?
    @State private var phoneSale: SaleDraft?
    @State private var discarding: DraftRow?
    @State private var failure: String?
    /// Drafts the demo has thrown away (nothing is sent in the demo).
    @State private var demoGone: Set<String> = []
    /// Month-old drafts already asked to go, so a list that redraws does not ask twice.
    @State private var purged: Set<String> = []

    /// One row: a draft in Drafts, or this phone's own work that Drafts does not hold.
    struct DraftRow: Identifiable {
        let draft: WorkDraft
        /// Only this phone has it (staff, drafts turned off, not yet sent).
        let phoneOnly: Bool
        /// This phone holds the work of this draft, so the native form continues it.
        let native: Bool
        var id: String { phoneOnly ? "phone-" + draft.kind : draft.id }
    }

    var body: some View {
        Group {
            if session.role == "owner" || session.role == "staff" {
                ShelfState(loaded: ready, error: nil, offline: readsDrafts && shelf.offline) { page }
            } else {
                WorkNotYours(title: "Drafts", detail: "Orders and sales not yet saved are kept for the shop's owners and staff.")
            }
        }
        .navigationTitle("Drafts")
        .onAppear { start() }
        .onDisappear { shelf.reset() }
        .confirmationDialog("Discard this draft?", isPresented: discardShown, titleVisibility: .visible, presenting: discarding) { row in
            Button("Discard", role: .destructive) { discard(row) }
            Button("Keep it", role: .cancel) {}
        } message: { row in
            Text("\(row.draft.isOrder ? "Order" : "Sale") for \(row.draft.title).")
        }
        .alert("Not discarded", isPresented: failureShown) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    // MARK: Reading

    private var readsDrafts: Bool { session.isOwner && !House.isDemo }

    /// Staff and the demo have nothing to wait for; an owner waits for Firestore's first answer (or its failure,
    /// when this phone's own work is shown anyway).
    private var ready: Bool { !readsDrafts || shelf.loaded }

    private func start() {
        book.settings.need()
        if readsDrafts { shelf.need() }
        phoneOrder = NewOrderDraftStore.load().map { (d: NewOrderDraft) -> NewOrderDraft in
            var lite = d
            lite.pieces = lite.pieces.map { (p: NewOrderPieceDraft) -> NewOrderPieceDraft in
                var q = p
                q.photo = nil
                return q
            }
            return lite
        }
        phoneSale = session.isOwner ? SaleDraftStore.load() : nil
    }

    private var discardShown: Binding<Bool> {
        Binding(get: { discarding != nil }, set: { if !$0 { discarding = nil } })
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
    }

    // MARK: The rows

    /// The drafts that are in hand, and the ones a month old (which the web removes as it sees them).
    private func lists(now: Date) -> (live: [WorkDraft], expired: [WorkDraft]) {
        if House.isDemo { return draftList(WorkDemo.drafts().filter { !demoGone.contains($0.id) }, now: now) }
        return draftList(readsDrafts ? shelf.items : [], now: now)
    }

    private func rows(_ live: [WorkDraft]) -> [DraftRow] {
        let orderId = WorkDraftSync.order.id
        let saleId = WorkDraftSync.sale.id
        var out: [DraftRow] = []
        var hasOrder = false
        var hasSale = false
        for d in live {
            var native = false
            if d.isOrder, phoneOrder != nil, d.id == orderId { native = true; hasOrder = true }
            if d.isSale, phoneSale != nil, d.id == saleId { native = true; hasSale = true }
            out.append(DraftRow(draft: d, phoneOnly: false, native: native))
        }
        // Work only this phone has comes first: it is what is being typed now. One that was sent to Drafts and is
        // no longer there was finished or discarded at the counter; the form clears it when it next opens.
        let seesDrafts = readsDrafts && shelf.loaded && shelf.error == nil
        var mine: [DraftRow] = []
        if let o = phoneOrder, !hasOrder, !(seesDrafts && orderId != nil) {
            mine.append(DraftRow(draft: orderCard(o), phoneOnly: true, native: true))
        }
        if let s = phoneSale, !hasSale, !(seesDrafts && saleId != nil) {
            mine.append(DraftRow(draft: saleCard(s), phoneOnly: true, native: true))
        }
        return mine + out
    }

    /// The card of the order kept on this phone, worked out as Drafts' own would be (`summarizeOrder`).
    private func orderCard(_ d: NewOrderDraft) -> WorkDraft {
        let t = NewOrderMath.totals(d, book.settings.value)
        let names = d.pieces
            .map { (p: NewOrderPieceDraft) -> String in p.description.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return WorkDraft(id: "phone-order", kind: "order", title: draftTitle(customer: d.customerName),
                         detail: draftOrderDetail(names: names, pieces: d.pieces.count, advance: t.advance),
                         items: d.pieces.count, total: max(0, t.balance), device: "", createdAt: "", updatedAt: "")
    }

    /// The card of the sale kept on this phone: the pieces at today's rates, as the New screen's card has it.
    private func saleCard(_ d: SaleDraft) -> WorkDraft {
        var subtotal = 0.0
        if let s = book.settings.value {
            let rates = PricingRates(s)
            for line in d.lines { subtotal += calculateProductCosts(line.priced, rates).totalPrice }
        }
        let names = d.lines
            .map { (l: SaleLine) -> String in l.name.isEmpty ? l.sku : l.name }
            .filter { !$0.isEmpty }
        return WorkDraft(id: "phone-sale", kind: "sale", title: draftTitle(customer: d.customerName),
                         detail: draftSaleDetail(names: names, discount: SaleNumber.value(d.discount)),
                         items: d.lines.count, total: max(0, subtotal), device: "", createdAt: "", updatedAt: "")
    }

    /// Where a row opens: the native form where this phone holds the work, else the ERP's form on the draft.
    private func path(_ row: DraftRow) -> String {
        if row.native { return row.draft.isOrder ? "/orders/add" : "/invoices/new" }
        return draftHref(kind: row.draft.kind, id: row.draft.id) + "&web=1"
    }

    // MARK: The page

    @ViewBuilder
    private var page: some View {
        let now = Date()
        let split = lists(now: now)
        let all = rows(split.live)
        let orders = all.filter { $0.draft.isOrder }
        let sales = all.filter { $0.draft.isSale }
        List {
            section("Orders", rows: orders, empty: "No unfinished orders.", newPath: "/orders/add", newTitle: "New order")
            // A sale is an owner's to make (the ERP's write is for owners), so staff are not shown a place for them.
            if session.isOwner {
                section("Sales", rows: sales, empty: "No unfinished sales.", newPath: "/invoices/new", newTitle: "New sale")
            }
            Section {
                footer
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .task(id: split.expired.map(\.id)) { await removeExpired(split.expired) }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("New orders and sales, kept as they are typed — on every device. One leaves this list the moment it is saved as an order or invoice, and after \(DRAFT_MAX_AGE_DAYS) days untouched. Orders and invoices that already exist are never drafted.")
            if !session.isOwner {
                Text("Drafts begun on other devices are listed for the shop's owners; this shows what is kept on this phone.")
            }
            if readsDrafts, let error = shelf.error, !error.isEmpty {
                Text("The shop's drafts could not be read: \(error)").foregroundStyle(.red)
            }
        }
    }

    private func section(_ title: String, rows: [DraftRow], empty: String, newPath: String, newTitle: String) -> some View {
        Section {
            if rows.isEmpty {
                Text(empty).foregroundStyle(.secondary)
            } else {
                ForEach(rows) { row in draftRow(row) }
            }
            NavigationLink(value: Route(path: newPath)) {
                Label(newTitle, systemImage: "plus")
            }
        } header: {
            HStack(spacing: 6) {
                Text(title)
                if !rows.isEmpty { Text("\(rows.count)").foregroundStyle(.secondary) }
            }
        }
        .houseRows()
    }

    private func draftRow(_ row: DraftRow) -> some View {
        let d = row.draft
        return NavigationLink(value: Route(path: path(row))) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(d.title).font(.headline).lineLimit(1)
                    Spacer(minLength: 8)
                    if d.total > 0 {
                        Text(Money.pkr(d.total)).font(.subheadline.weight(.semibold)).monospacedDigit()
                    }
                }
                if !d.detail.isEmpty {
                    Text(d.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
                Text(lastTyped(row)).font(.caption).foregroundStyle(.tertiary)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) { discarding = row } label: { Label("Discard", systemImage: "trash") }
        }
        .contextMenu {
            Button(role: .destructive) { discarding = row } label: { Label("Discard", systemImage: "trash") }
        }
    }

    /// "Last typed Today 4:05 pm on iPhone" (and a note when the photos were too big to keep).
    private func lastTyped(_ row: DraftRow) -> String {
        let d = row.draft
        if row.phoneOnly { return "On this phone" }
        var line = "Last typed " + ShopDate.say(d.updatedAt, withTime: true)
        if !d.device.isEmpty { line += " on " + d.device }
        if d.leftOut.contains("photos") { line += " · sample photos too large to keep" }
        return line
    }

    // MARK: Discarding

    /// Gone from Drafts, and from this phone if the work is this phone's (or the form would put it straight back).
    private func discard(_ row: DraftRow) {
        let d = row.draft
        if House.isDemo {
            demoGone.insert(d.id)
            return
        }
        Task {
            if row.native {
                if d.isOrder {
                    NewOrderDraftStore.clear()
                    WorkDraftSync.order.drop()
                    phoneOrder = nil
                } else {
                    SaleDraftStore.clear()
                    WorkDraftSync.sale.drop()
                    phoneSale = nil
                }
                return
            }
            do {
                try await ERPAPI.shared.send("/api/app/drafts", ["action": "drop", "id": d.id])
            } catch {
                failure = "\(error.localizedDescription) The draft is still in the list."
            }
        }
    }

    /// A month without a keystroke and a draft is clutter: the web removes it as it sees it, and so does this.
    private func removeExpired(_ expired: [WorkDraft]) async {
        guard readsDrafts else { return }
        for d in expired where !purged.contains(d.id) && isDraftId(d.id) {
            purged.insert(d.id)
            _ = try? await ERPAPI.shared.send("/api/app/drafts", ["action": "drop", "id": d.id])
        }
    }
}
