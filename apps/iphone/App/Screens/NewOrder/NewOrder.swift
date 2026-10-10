import SwiftUI
import UIKit
import ERPCore

/// New order (src/app/orders/add/page.tsx, components/order/order-form.tsx): who it is for, when it is
/// promised, the pieces (each opens full-screen), the rates, the discount, the advance and the exchange,
/// and the totals as the web works them out. Saved through the ERP's own shared write (`createOrder`,
/// lib/writes/create-order.ts): it numbers the order and stamps the rates, exactly as the browser's does.
///
/// The order in progress stays on this phone, and in Drafts, if the screen closes (NewOrderDraftStore,
/// WorkDraftSync), until it is saved or started over. A piece can start from one in stock (Add from stock);
/// sizes are offered to the customer's profile once the order is saved (NewOrderSizeAsk). "Read a slip" reads a parchi
/// with the ERP's AI reader into this form (NewOrderScanScreen); the voice order stays on the ERP's page.
///
/// Edit order (/orders/<id>/edit) is this same form opened on the order on file (NewOrderEdit): nothing is kept
/// on the phone or in Drafts, there is no starting over, and Save writes the changes (`updateOrder`), owners only
/// as in the browser.
struct NewOrder: View {
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss

    /// The order being edited, or nil for a new one.
    private let edit: NewOrderEdit?
    /// Opened from the New chooser's Scan a parchi: the slip reader comes up over the form, once.
    private let readsSlip: Bool
    @State private var readerOpened = false
    @State private var readingSlip = false

    @State private var draft = NewOrderDraft.fresh()
    /// The phone's copy has been read (and not before: an unread draft must never be overwritten).
    @State private var loaded = false
    @State private var restored = false
    @State private var editing: NewOrderPieceRef?
    @State private var saving = false
    @State private var failure: String?
    @State private var failureTitle = "The order wasn't saved"
    @State private var created: String?
    /// The sizes on offer to the customer's profile once the order is saved.
    @State private var sizeAsk: NewOrderSizeAsk?
    @State private var confirmReset = false
    @State private var pickingStock = false

    init(readsSlip: Bool = false) {
        edit = nil
        self.readsSlip = readsSlip
    }

    init(edit: NewOrderEdit) {
        self.edit = edit
        readsSlip = false
        _draft = State(initialValue: edit.draft)
        _loaded = State(initialValue: true)
    }

    var body: some View {
        Group {
            if let created {
                NewOrderLanding(id: created)
            } else if edit != nil && session.role != "owner" {
                ContentUnavailableView("Only an owner can change an order", systemImage: "lock", description: Text("Ask an owner to make the change, or add a note on the order."))
            } else if session.role == "owner" || session.role == "staff" {
                form
            } else {
                ContentUnavailableView("Orders are taken by the shop", systemImage: "lock", description: Text("Sign in with an owner or staff account to take an order."))
            }
        }
        .onAppear { start() }
        .sheet(item: $sizeAsk) { ask in NewOrderSizeAskSheet(ask: ask) }
        .navigationDestination(isPresented: $readingSlip) { NewOrderScanScreen(draft: $draft) }
    }

    // MARK: Reading

    /// Customers who are people: not removed, not the old "Walk-in Customer" records (lib/walk-in.ts).
    private var people: [Customer] {
        NewOrderMath.people(book.customers.items)
    }

    private var karigars: [Karigar] {
        book.karigars.items.filter { ($0.deletedAt ?? "").isEmpty }
    }

    /// The customer's saved address, then every address their orders and invoices were delivered to, once each.
    private var knownAddresses: [String] {
        guard !draft.customerId.isEmpty else { return [] }
        var out: [String] = []
        var seen = Set<String>()
        func take(_ raw: String?) {
            let a = NewOrderFormat.trim(raw ?? "")
            if a.isEmpty || !seen.insert(a.lowercased()).inserted { return }
            out.append(a)
        }
        take(book.customers.item(draft.customerId)?.address)
        for o in book.orders.items where o.customerId == draft.customerId { take(o.delivery?.address) }
        for i in book.invoices.items where i.customerId == draft.customerId { take(i.delivery?.address) }
        return out
    }

    private func start() {
        book.customers.need()
        book.karigars.need()
        book.settings.need()
        book.orders.need()
        book.invoices.need()
        if !loaded {
            if let saved = NewOrderDraftStore.load() {
                draft = saved
                restored = true
                Task { await stillOurs() }
            }
            loaded = true
        }
        seedRates()
        settleTakenBy()
        if readsSlip && !readerOpened && created == nil {
            readerOpened = true
            readingSlip = true
        }
    }

    /// The order kept on this phone is in Drafts too: one saved or thrown away at the counter since is not this
    /// phone's to save a second time, so it goes from here as well.
    private func stillOurs() async {
        guard await WorkDraftSync.order.stillThere() == false, created == nil else { return }
        NewOrderDraftStore.clear()
        WorkDraftSync.order.forget()
        draft = NewOrderDraft.fresh()
        restored = false
        editing = nil
        seedRates()
        settleTakenBy()
        tell("Finished on another device", "The order kept on this phone was saved or discarded from Drafts on another device, so it is cleared here. Look for it under Orders.")
    }

    /// The order in Drafts as the web's form holds it, a moment after the last change (`now` as the screen or
    /// the app goes), so it can be finished at the counter (WorkDraftSync).
    private func sync(now: Bool = false) {
        guard loaded, created == nil, edit == nil else { return }
        let d = draft
        let settings = book.settings.value
        WorkDraftSync.order.push(blank: d.isBlank, enabled: settings?.autoDraftForms ?? true, now: now) {
            WorkDraftSync.Snapshot(
                values: d.webValues(settings: settings),
                total: NewOrderMath.totals(d, settings).balance,
                customerName: d.customerName
            )
        }
    }

    /// "Taken by" starts on the signed-in person (their counter name on the house's list), once.
    private func settleTakenBy() {
        guard loaded, edit == nil, let shop = session.me?.shop else { return }
        draft.settleTakenBy(person: shop.person, list: shop.takenBy)
    }

    /// The rates start as today's, once; a draft that is continued keeps the rates it was quoted at.
    private func seedRates() {
        guard loaded, !draft.ratesSeeded, let s = book.settings.value else { return }
        draft.seedRates(from: s)
    }

    // MARK: The form

    private var form: some View {
        let settings = book.settings.value
        let totals = NewOrderMath.totals(draft, settings)
        return screen(totals, settings)
            .alert(failureTitle, isPresented: failureShown) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
            .confirmationDialog("Start this order over?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Start over", role: .destructive) { startOver() }
                Button("Keep it", role: .cancel) {}
            } message: {
                Text("Everything typed so far is cleared from this phone and from Drafts.")
            }
            .interactiveDismissDisabled(saving)
            .sensoryFeedback(.success, trigger: created)
            .modifier(keeping)
    }

    /// The form, its bar and its toolbar.
    private func screen(_ totals: NewOrderMath.Totals, _ settings: Settings?) -> some View {
        Form { Group {
            if restored { restoredBanner }
            if edit?.invoiced == true {
                Section {
                    Label("This order is on an invoice already. The invoice keeps its own copy of the pieces and the money: change those on the invoice.", systemImage: "doc.text")
                        .font(.subheadline)
                }
            }
            NewOrderCustomerSection(draft: $draft, people: people, takenBy: session.shop.takenBy) {
                CustomerField.recent(invoices: book.invoices.items, orders: book.orders.items, book: book.customers.items)
            }
            NewOrderPromisedSection(draft: $draft)
            piecesSection(totals)
            NewOrderRatesSection(draft: $draft, settings: settings)
            NewOrderPrintedSection(draft: $draft)
            NewOrderPaymentSection(draft: $draft)
            NewOrderExchangeSection(draft: $draft)
            tail(totals, settings)
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(edit.map { "Edit \($0.orderId)" } ?? "New order")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The AI slip reader (NewOrderScanScreen): the ERP's own reader, its answer laid into this draft.
            if edit == nil {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        NewOrderScanScreen(draft: $draft)
                    } label: {
                        Label("Read a slip", systemImage: "doc.text.viewfinder")
                            .labelStyle(.titleAndIcon)
                    }
                }
            }
        }
        .newOrderKeyboardDone()
        .safeAreaBar(edge: .bottom) { saveBar(totals) }
        .navigationDestination(item: $editing) { ref in editor(ref.id) }
    }

    /// Kept on this phone as it is typed: a moment after the last key, and at once when the app leaves.
    private var keeping: NewOrderKeeping {
        NewOrderKeeping(
            draft: draft,
            // An edit is never kept on the phone or in Drafts: the order on file is the copy.
            loaded: loaded && edit == nil,
            settingsValue: book.settings.value,
            keep: { keepNow() },
            sync: { sync() },
            seed: { seedRates() }
        )
    }

    private func keepNow() {
        guard loaded, created == nil, edit == nil else { return }
        NewOrderDraftStore.save(draft, now: true)
        sync(now: true)
    }

    private var failureShown: Binding<Bool> {
        Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })
    }

    private var restoredBanner: some View {
        Section {
            if draft.fromSale {
                Label("These are the pieces of your sale. Once this order is saved they leave the sale.", systemImage: "arrow.right.circle")
                    .font(.subheadline)
            } else {
                Label("Your order in progress is back. It was kept on this phone.", systemImage: "arrow.uturn.backward.circle")
                    .font(.subheadline)
            }
            if draft.photosLeftOut {
                Label("The sample photos were too many to keep: add them again.", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            }
        }
    }

    // MARK: The pieces

    private func piecesSection(_ totals: NewOrderMath.Totals) -> some View {
        Section {
            ForEach(Array(draft.pieces.enumerated()), id: \.element.id) { index, piece in
                Button { editing = NewOrderPieceRef(id: piece.id) } label: {
                    NewOrderPieceRow(piece: piece, number: index + 1, price: index < totals.prices.count ? totals.prices[index] : 0)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { removePiece(piece.id) } label: {
                        Label("Remove", systemImage: "trash")
                    }
                }
                .swipeActions(edge: .leading) {
                    Button { duplicatePiece(piece.id) } label: {
                        Label("Duplicate", systemImage: "plus.square.on.square")
                    }
                    .tint(.blue)
                }
                .contextMenu {
                    Button { duplicatePiece(piece.id) } label: {
                        Label("Duplicate", systemImage: "plus.square.on.square")
                    }
                    Button(role: .destructive) { removePiece(piece.id) } label: {
                        Label("Remove", systemImage: "trash")
                    }
                }
            }
            Button(action: addPiece) {
                Label("Add a piece", systemImage: "plus.circle.fill")
            }
            Button { pickingStock = true } label: {
                Label("Add from stock", systemImage: "shippingbox")
            }
            .sheet(isPresented: $pickingStock) {
                NewOrderStockPicker { p in addFromStock(p) }
            }
        } header: {
            LedgerHeading(title: "Pieces")
        } footer: {
            NewOrderPiecesFooter(count: draft.pieces.count)
        }
    }

    /// A piece in stock as the start of one to be made (the web's "Add from Inventory"): everything copied, its SKU
    /// the reference, and it opens to be changed.
    private func addFromStock(_ p: Product) {
        let piece = NewOrderPieceDraft(fromSale: SaleLine(p))
        draft.pieces.append(piece)
        editing = NewOrderPieceRef(id: piece.id)
    }

    /// A new piece opens at once: it is what you came to fill in.
    private func addPiece() {
        let piece = NewOrderPieceDraft()
        draft.pieces.append(piece)
        editing = NewOrderPieceRef(id: piece.id)
    }

    private func duplicatePiece(_ id: UUID) {
        draft.duplicatePiece(id)
    }

    private func removePiece(_ id: UUID) {
        draft.pieces.removeAll { $0.id == id }
    }

    private func pieceBinding(_ id: UUID) -> Binding<NewOrderPieceDraft> {
        Binding(
            get: { draft.pieces.first(where: { $0.id == id }) ?? NewOrderPieceDraft() },
            set: { next in
                if let i = draft.pieces.firstIndex(where: { $0.id == id }) { draft.pieces[i] = next }
            }
        )
    }

    @ViewBuilder
    private func editor(_ id: UUID) -> some View {
        if let i = draft.pieces.firstIndex(where: { $0.id == id }) {
            NewOrderPieceEditor(
                piece: pieceBinding(id),
                number: i + 1,
                rates: NewOrderMath.formRates(draft, book.settings.value),
                karigars: karigars,
                onDuplicate: { duplicatePiece(id) },
                onRemove: { removePiece(id) }
            )
        } else {
            ContentUnavailableView("That piece is gone", systemImage: "trash")
        }
    }

    // MARK: The rest of the form

    @ViewBuilder
    private func tail(_ totals: NewOrderMath.Totals, _ settings: Settings?) -> some View {
        NewOrderNotesSection(draft: $draft)
        NewOrderDeliverySection(draft: $draft, knownAddresses: { knownAddresses })
        // The shop's own figure: owners and staff, never the customer (decisions.md "Margin").
        if House.margin.rattiLess != nil {
            NewOrderMarginSection(draft: $draft, settings: settings) {
                NewOrderMath.margin(draft, settings, totals)
            }
        }
        NewOrderTotalsSection(totals: totals, pieces: draft.pieces.count)
        if edit == nil && !draft.isBlank {
            Section {
                Button("Start over", role: .destructive) { confirmReset = true }
            } footer: {
                Text("Your order is kept on this phone, and in Drafts for the counter, until you save it or start over.")
            }
        }
    }

    private func startOver() {
        NewOrderDraftStore.clear()
        WorkDraftSync.order.drop()
        draft = NewOrderDraft.fresh()
        restored = false
        editing = nil
        seedRates()
        settleTakenBy()
    }

    // MARK: Saving

    /// THE action of the screen: one glass button, with the balance beside it.
    private func saveBar(_ totals: NewOrderMath.Totals) -> some View {
        // The balance rides in its own glass beside the button, so it reads over whatever scrolls beneath.
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Balance due").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                MoneyText(amount: totals.balance, exact: true)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .glassEffect(.regular, in: .capsule)
            Spacer(minLength: 8)
            Button {
                Task { await save() }
            } label: {
                Group {
                    if saving {
                        SkeletonLoading()
                    } else {
                        Text(edit == nil ? "Save order" : "Save changes")
                    }
                }
                .frame(minWidth: 120)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
            .disabled(saving)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    /// Sizes on the order that the customer's profile doesn't hold are offered once, over the order's own page.
    /// The customer is the one the ERP names on the order (a new one it has just made, or the one on file).
    private func offerSizes(_ made: [String: Any]) {
        let customerId = made["customerId"] as? String
        let profile = customerId.flatMap { book.customers.item($0) }
        let rows = NewOrderSizes.offer(draft, customerId: customerId, profile: profile, houseWants: session.shop.sizeToProfile)
        guard let customerId, !rows.isEmpty else { return }
        let name = (made["customerName"] as? String) ?? profile?.name ?? "the customer"
        sizeAsk = NewOrderSizeAsk(customerId: customerId, name: name, rows: rows)
    }

    private func tell(_ title: String, _ message: String) {
        failureTitle = title
        failure = message
    }

    /// The same checks as the web's form (`orderFormSchema`), then `createOrder` with `{ order }`, then the
    /// order's own page replaces this one. The ERP numbers the order and stamps the rates; nothing here
    /// updates a shelf, the new order arrives on it by itself.
    private func save() async {
        guard !saving else { return }
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        guard let settings = book.settings.value else {
            tell("The order can't be saved yet", "The shop's rates haven't loaded. Check the connection and try again.")
            return
        }
        if let problem = NewOrderMath.problem(draft, takenBy: session.shop.takenBy) {
            tell("The order can't be saved yet", problem)
            return
        }
        saving = true
        defer { saving = false }
        if let edit {
            // The form's edit path: the ERP lays these fields over the order on file and its pieces.
            let request = NewOrderMath.editRequest(draft, edit: edit, settings: settings, customers: people)
            do {
                _ = try await ERPAPI.shared.write("updateOrder", request)
                dismiss()
            } catch let e as ERPAPI.Failure {
                tell("The changes weren't saved", e.message)
            } catch {
                tell("The changes weren't saved", error.localizedDescription + "\n\nIf the connection dropped, the changes may have been saved. Check the order before saving again.")
            }
            return
        }
        let request = NewOrderMath.request(draft, settings: settings, customers: people)
        do {
            let out = try await ERPAPI.shared.write("createOrder", request)
            guard let made = out["order"] as? [String: Any], let id = made["id"] as? String, !id.isEmpty else {
                throw ERPAPI.Failure(status: 0, message: "The ERP saved the order but didn't say its number. Look for it in Orders.")
            }
            NewOrderDraftStore.clear()
            WorkDraftSync.order.drop()
            // Made from the sale in progress: the pieces are the order's now, and leaving them on the sale would
            // bill the same pieces a second time (the web clears the cart).
            if draft.fromSale {
                SaleDraftStore.clear()
                WorkDraftSync.sale.drop()
            }
            offerSizes(made)
            // Blank, so a keep that was already on its way writes nothing back.
            draft = NewOrderDraft.fresh()
            created = id
        } catch let e as ERPAPI.Failure {
            // The ERP has seen this very order already (a second tap, a retry): it is made, not lost.
            let seen = e.status == 409 && e.message.hasPrefix("This was already sent")
            tell(seen ? "Already sent" : "The order wasn't saved", e.message)
        } catch {
            // No answer is not "no": the order may have gone through, and saving again would make a second.
            tell("The order wasn't saved", error.localizedDescription + "\n\nIf the connection dropped, the order may have been saved. Check Orders before saving it again.")
        }
    }
}

/// The order stays on this phone while it is typed (NewOrderDraftStore): written a moment after the last
/// key, and at once when the app leaves or the screen goes. It also seeds the rates when the shop's settings
/// arrive. Its own modifier so the form's chain of
/// modifiers stays short for the compiler.
struct NewOrderKeeping: ViewModifier {
    let draft: NewOrderDraft
    let loaded: Bool
    let settingsValue: Settings?
    let keep: () -> Void
    /// Drafts' copy, a second after this phone's (WorkDraftSync).
    let sync: () -> Void
    let seed: () -> Void

    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .task(id: draft) {
                guard loaded else { return }
                do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
                NewOrderDraftStore.save(draft)
                sync()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { keep() }
            }
            .onChange(of: settingsValue) { _, _ in seed() }
            .onDisappear { keep() }
    }
}

/// After the save: the new order's own page replaces the form. The order reaches the shelf a moment
/// after the write, so a short wait keeps the page from saying "Order not found" first.
struct NewOrderLanding: View {
    let id: String

    @Environment(Book.self) private var book
    @State private var waited = false

    var body: some View {
        if waited || book.orders.items.contains(where: { $0.id == id }) {
            OrderScreen(id: id)
        } else {
            VStack(spacing: 12) {
                SkeletonLoading().controlSize(.large)
                Text("Opening \(id)…").foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(id)
            .navigationBarTitleDisplayMode(.inline)
            .task {
                book.orders.need()
                try? await Task.sleep(for: .seconds(4))
                waited = true
            }
        }
    }
}
