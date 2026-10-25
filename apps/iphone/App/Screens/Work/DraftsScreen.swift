import SwiftUI
import FirebaseFirestore
import ERPCore

/// Drafts (src/app/drafts/page.tsx, docs/decisions.md "Drafts"): orders and sales started and not yet saved, on every
/// device, newest typed first, each with who it is for, what is in it, the running total, and when and where it was
/// last typed. Continue opens it; Discard removes it (after asking: the web has an Undo, the phone asks first).
///
/// Owners read Firestore `drafts` live, as the web does. Staff have no Firestore (firestore.rules) and the server has no
/// list of drafts for them, so they see what is kept on this phone, which is their own order in progress.
///
/// A draft this phone wrote (WorkDraftSync) and still holds is continued in the native form, which holds that work
/// already (NewOrderDraftStore, SaleDraftStore). Any other is read from Drafts, put into the native form
/// (WorkDraftContinue) and taken on as this phone's draft, so the next change writes over it and saving removes it,
/// as the web's form does with `?draft=`. The work this phone held before is made sure of in Drafts first, so nothing
/// is replaced and nothing is asked. A draft opens only from here: a New order or New sale is always blank.
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
    /// Bumped when a discard is confirmed, for the warning tap.
    @State private var discardedCount = 0
    /// Drafts the demo has thrown away (nothing is sent in the demo).
    @State private var demoGone: Set<String> = []
    /// Month-old drafts already asked to go, so a list that redraws does not ask twice.
    @State private var purged: Set<String> = []
    /// The draft being read from Drafts.
    @State private var continuing: String?
    /// The native form, once the draft is in it.
    @State private var opening: Route?
    #if os(macOS)
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var macSelection = Set<String>()
    @State private var macSort = [KeyPathComparator(\DraftsScreen.DraftRow.updatedAt, order: .reverse)]
    #endif

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
                ShelfState(loaded: ready, error: nil, offline: readsDrafts && shelf.offline) {
                    #if os(macOS)
                    macPage
                    #else
                    page
                    #endif
                }
            } else {
                WorkNotYours(title: "Drafts", detail: "Orders and sales not yet saved are kept for the shop's owners and staff.")
            }
        }
        .navigationTitle("Drafts")
        .hubTitleDisplay()
        .onAppear { start() }
        .onDisappear { shelf.reset() }
        .confirmationDialog("Discard this draft?", isPresented: discardShown, titleVisibility: .visible, presenting: discarding) { row in
            Button("Discard", role: .destructive) { discardedCount += 1; discard(row) }
            Button("Keep it", role: .cancel) {}
        } message: { row in
            Text("\(row.draft.isOrder ? "Order" : "Sale") for \(row.draft.title).")
        }
        .navigationDestination(item: $opening) { (r: Route) in PlaceScreen(path: r.path) }
        .failureAlert($failure, title: "Not done")
        .destructiveFeedback(trigger: discardedCount)
    }

    // MARK: Reading

    private var readsDrafts: Bool { session.isOwner && !House.isDemo }

    /// Staff and the demo have nothing to wait for; an owner waits for Firestore's first answer (or its failure,
    /// when this phone's own work is shown anyway).
    private var ready: Bool { !readsDrafts || shelf.loaded }

    private func start() {
        book.settings.need()
        if session.isOwner { book.customers.need() }
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
        // Drafts that could not be sent (no line) are sent now if the line is back.
        WorkDraftSync.resumeAll()
    }

    private var discardShown: Binding<Bool> {
        Binding(get: { discarding != nil }, set: { if !$0 { discarding = nil } })
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

    /// The native form of a row's kind, opened on the work this phone holds (`?resume=1`): a New order or New sale
    /// is blank, a draft is continued from here.
    private func path(_ row: DraftRow) -> String {
        row.draft.isOrder ? "/orders/add?resume=1" : "/invoices/new?resume=1"
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
        .motion(all.map(\.id))
        .task(id: split.expired.map(\.id)) { await removeExpired(split.expired) }
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: pt(6)) {
            Text("New orders and sales, kept as they are typed — on every device. One leaves this list the moment it is saved as an order or invoice, and after \(DRAFT_MAX_AGE_DAYS) days untouched. Orders and invoices that already exist are never drafted.")
            if !session.isOwner {
                Text("Drafts begun on other devices are listed for the shop's owners; this shows what is kept on this phone.")
            }
            if readsDrafts, let error = shelf.error, !error.isEmpty {
                Text("The shop's drafts could not be read: \(error)")
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
            LedgerHeading(title: title, count: rows.count)
        }
        .houseRows()
    }

    @ViewBuilder
    private func draftRow(_ row: DraftRow) -> some View {
        if row.native {
            NavigationLink(value: Route(path: path(row))) { draftCard(row) }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) { discardButton(row) }
                .contextMenu { discardButton(row) }
        } else {
            // Begun elsewhere: read from Drafts into the phone's own form first.
            Button { ask(row) } label: {
                HStack {
                    draftCard(row)
                    if continuing == row.draft.id {
                        ProgressView()
                    } else {
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(continuing != nil)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) { discardButton(row) }
            .contextMenu { discardButton(row) }
        }
    }

    private func discardButton(_ row: DraftRow) -> some View {
        Button(role: .destructive) { discarding = row } label: { Label("Discard", systemImage: "trash") }
    }

    private func draftCard(_ row: DraftRow) -> some View {
        let d = row.draft
        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(d.title).font(.headline).lineLimit(1)
                Spacer(minLength: 8)
                if d.total > 0 {
                    RowAmount(amount: d.total)
                }
            }
            if !d.detail.isEmpty {
                Text(d.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            Text(lastTyped(row)).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
    }

    // MARK: Continuing a draft from another device

    /// A draft that is not this phone's current one is read in. The work this phone holds of that kind goes to Drafts
    /// first, so there is nothing to ask.
    private func ask(_ row: DraftRow) {
        Task { await continueHere(row) }
    }

    /// The draft as Drafts holds it, into the native form, and taken on as this phone's (the form's `?draft=`).
    private func continueHere(_ row: DraftRow) async {
        let d = row.draft
        if House.isDemo {
            // The demo's drafts are cards only: the form opens as it is.
            #if os(macOS)
            macOpen(Route(path: path(row)))
            #else
            opening = Route(path: path(row))
            #endif
            return
        }
        guard continuing == nil, let db = await Businesses.shared.firestore else { return }
        continuing = d.id
        defer { continuing = nil }
        do {
            let snap = try await db.collection("drafts").document(d.id).getDocument()
            guard snap.exists, let raw = snap.data() else {
                failure = "That draft is no longer there. It was saved as an \(d.isOrder ? "order" : "invoice") or discarded."
                return
            }
            let doc = DocJSON.plain(raw, custom: FirestoreSource.plainSDK) as? [String: Any] ?? [:]
            let values = doc["data"] as? [String: Any] ?? [:]
            // What this phone held goes to Drafts first (sent now, kept on disk until it lands), then this draft is
            // the phone's work.
            if d.isOrder {
                if let held = NewOrderDraftStore.load(), WorkDraftSync.order.id != d.id {
                    let settings = book.settings.value
                    WorkDraftSync.order.release(business: House.business, enabled: settings?.autoDraftForms ?? true) { WorkDraftSync.snapshot(held, settings: settings) }
                }
                NewOrderDraftStore.save(WorkDraftContinue.order(values, settings: book.settings.value), now: true)
                WorkDraftSync.order.adopt(id: d.id, createdAt: d.createdAt)
                phoneOrder = NewOrderDraftStore.load()
            } else {
                if let held = SaleDraftStore.load(), WorkDraftSync.sale.id != d.id {
                    let settings = book.settings.value
                    let customers = book.customers.items
                    WorkDraftSync.sale.release(business: House.business, enabled: settings?.autoDraftForms ?? true) { WorkDraftSync.snapshot(held, settings: settings, customers: customers) }
                }
                SaleDraftStore.save(WorkDraftContinue.sale(values, customer: { (id: String) in book.customers.item(id) }))
                WorkDraftSync.sale.adopt(id: d.id, createdAt: d.createdAt)
                phoneSale = SaleDraftStore.load()
            }
            #if os(macOS)
            macOpen(Route(path: path(row)))
            #else
            opening = Route(path: path(row))
            #endif
        } catch {
            failure = "The draft could not be read: \(error.localizedDescription)"
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
            // One still waiting to be sent (no line) must not come back after this.
            (d.isOrder ? WorkDraftSync.order : WorkDraftSync.sale).abandon(d.id)
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

#if os(macOS)
extension DraftsScreen.DraftRow {
    /// Table columns: what a row is, who it is for, what it comes to and when it was last typed.
    var kindWord: String { draft.isOrder ? "Order" : "Sale" }
    var title: String { draft.title }
    var total: Double { draft.total }
    var updatedAt: String { draft.updatedAt }
}

// The Mac's Drafts (docs/features/mac-design.md, "Drafts"): one Table of the orders and sales in hand (sortable). Return or a
// double-click continues the draft in a window of its own, the same form the iPhone pushes; ⌫ discards it, after asking. The
// Draft menu, the toolbar and the right-click menu are the same two actions.
extension DraftsScreen {
    @ViewBuilder
    var macPage: some View {
        let now = Date()
        let split = lists(now: now)
        let all = rows(split.live).filter { session.isOwner || $0.draft.isOrder }
        let ordered = all.sorted(using: macSort)
        let groups = macActions(macSelection, all)
        Table(ordered, selection: $macSelection, sortOrder: $macSort) {
            TableColumn("Kind", value: \.kindWord) { (r: DraftRow) in
                Label(r.kindWord, systemImage: r.draft.isOrder ? "list.clipboard" : "receipt")
            }
            .width(min: 80, ideal: 90)
            TableColumn("For", value: \.title) { (r: DraftRow) in Text(r.draft.title).fontWeight(.medium) }
                .width(min: 140, ideal: 200)
            TableColumn("What is in it") { (r: DraftRow) in
                Text(r.draft.detail).foregroundStyle(.secondary).lineLimit(1)
            }
            .width(min: 180, ideal: 320)
            TableColumn("Pieces") { (r: DraftRow) in Text("\(r.draft.items)").monospacedDigit() }
                .width(55)
            TableColumn("Total", value: \.total) { (r: DraftRow) in
                Text(r.total > 0 ? Money.pkr(r.total) : "")
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Last typed", value: \.updatedAt) { (r: DraftRow) in
                Text(lastTyped(r)).foregroundStyle(.secondary).lineLimit(1)
            }
            .width(min: 180, ideal: 260)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            if !ids.isEmpty { MacActionItems(groups: macActions(ids, all)) }
        } primaryAction: { (ids: Set<String>) in
            if ids.count == 1, let row = all.first(where: { (r: DraftRow) in r.id == ids.first }) { macContinue(row) }
        }
        .onDeleteCommand { if let row = macPicked(all) { discarding = row } }
        .overlay {
            if all.isEmpty {
                ContentUnavailableView("No unfinished work", systemImage: "doc.on.doc",
                                       description: Text("A new order or sale is kept here as it is typed, on every device, until it is saved or has gone \(DRAFT_MAX_AGE_DAYS) days untouched."))
            }
        }
        .macSummaryBar(macSummary(all))
        .navigationSubtitle(all.isEmpty ? "" : "\(all.count) in hand")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                ForEach(groups.flatMap { (g: [MacAction]) in g }) { (a: MacAction) in MacToolbarAction(action: a) }
            }
        }
        .macRecordMenu(MacRecordMenu(title: "Draft", groups: groups))
        .task(id: split.expired.map(\.id)) { await removeExpired(split.expired) }
    }

    private func macPicked(_ all: [DraftRow]) -> DraftRow? {
        guard macSelection.count == 1, let id = macSelection.first else { return nil }
        return all.first { $0.id == id }
    }

    /// The draft's two actions, declared once, for whatever is picked (the table's selection, or the row right-clicked).
    private func macActions(_ ids: Set<String>, _ all: [DraftRow]) -> [[MacAction]] {
        let row: DraftRow? = ids.count == 1 ? all.first(where: { (r: DraftRow) in r.id == ids.first }) : nil
        let go = MacAction("Continue", symbol: "arrow.right.circle", shortcut: KeyboardShortcut(.return, modifiers: []),
                           enabled: row != nil && continuing == nil, isDefault: true, id: "continue") {
            if let row { macContinue(row) }
        }
        let drop = MacAction("Discard\u{2026}", symbol: "trash", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                             role: .destructive, enabled: row != nil, id: "discard") {
            if let row { discarding = row }
        }
        return [[go], [drop]]
    }

    /// "3 drafts", "2 orders", "1 sale", and what could not be read.
    private func macSummary(_ all: [DraftRow]) -> [String] {
        let orders = all.filter { (r: DraftRow) in r.draft.isOrder }.count
        let sales = all.count - orders
        var parts = ["\(all.count) draft\(all.count == 1 ? "" : "s")"]
        if orders > 0 && sales > 0 { parts.append("\(orders) order\(orders == 1 ? "" : "s")") }
        if orders > 0 && sales > 0 { parts.append("\(sales) sale\(sales == 1 ? "" : "s")") }
        if !session.isOwner { parts.append("Drafts begun on other devices are listed for the shop's owners; this shows what is kept on this Mac.") }
        if readsDrafts, let error = shelf.error, !error.isEmpty { parts.append("The shop's drafts could not be read: \(error)") }
        return parts
    }

    /// A draft's form in a window of its own (the stack where windows are not offered).
    fileprivate func macOpen(_ route: Route) {
        if let openPlace { openPlace(route) } else { opening = route }
    }

    /// Continue: this Mac's own work opens its form; a draft from elsewhere is read in first (taking the place of mine).
    private func macContinue(_ row: DraftRow) {
        if row.native { macOpen(Route(path: path(row))) } else { ask(row) }
    }
}
#endif
