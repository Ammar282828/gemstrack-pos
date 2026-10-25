import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
import ERPCore

/// New order (src/app/orders/add/page.tsx, components/order/order-form.tsx): who it is for, when it is
/// promised, the pieces (each opens full-screen), the rates, the discount, the advance and the exchange,
/// and the totals as the web works them out. Saved through the ERP's own shared write (`createOrder`,
/// lib/writes/create-order.ts): it numbers the order and stamps the rates, exactly as the browser's does.
///
/// The order in progress is kept at every change, on this phone and in Drafts (NewOrderDraftStore, WorkDraftSync), until
/// it is saved or started over. A New order always opens blank: the one kept before is in Drafts, continued from there
/// (or from a screen that opens this one with `?resume=1`). A piece can start from one in stock (Add from stock);
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
    /// Change rate: the order on file opens at the Pieces step with its rates on top.
    private let ratesFirst: Bool
    /// Opened to continue the order kept on this phone (Drafts' Continue, a sale's "Create order", the voice
    /// assistant: `?resume=1`); otherwise the form is blank and what was kept before has gone to Drafts.
    private let resumes: Bool
    @State private var readerOpened = false
    @State private var readingSlip = false

    @State private var draft = NewOrderDraft.fresh()
    /// The phone's copy has been dealt with (and not before: an unread draft must never be overwritten).
    @State private var loaded = false
    /// The draft this form was opened on, until the first change: opening a draft is not a change to it.
    @State private var baseline: NewOrderDraft?
    /// Waiting for the shop's settings to say whether drafts are kept, before deciding what to open.
    @State private var beginning = false
    /// The business this screen was opened in: every draft and the save go to it, whatever is open when they run.
    @State private var biz = House.business
    @State private var restored = false
    @State private var editing: NewOrderPieceRef?
    @State private var saving = false
    @State private var failure: String?
    @State private var failureTitle = "The order wasn't saved"
    @State private var created: String?
    /// The sizes on offer to the customer's profile once the order is saved.
    @State private var sizeAsk: NewOrderSizeAsk?
    @State private var savedEdit = false
    @State private var confirmReset = false
    @State private var pickingStock = false
    @State private var step: EntryStep = .customer
    /// Bumped on a saved order or edit, so the money tap is felt once (never per keystroke).
    @State private var saves = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(readsSlip: Bool = false, resumes: Bool = false) {
        edit = nil
        self.readsSlip = readsSlip
        self.resumes = resumes
        ratesFirst = false
    }

    init(edit: NewOrderEdit, ratesFirst: Bool = false) {
        self.edit = edit
        readsSlip = false
        resumes = false
        self.ratesFirst = ratesFirst
        if ratesFirst { _step = State(initialValue: .pieces) }
        _draft = State(initialValue: edit.draft)
        _loaded = State(initialValue: true)
    }

    var body: some View {
        Group {
            if let created {
                NewOrderLanding(id: created)
            } else if edit != nil && session.role != "owner" {
                NotAvailableState("Only an owner can change an order", why: "Ask an owner to make the change, or add a note on the order.", symbol: "lock")
            } else if session.role == "owner" || session.role == "staff" {
                form
            } else {
                NotAvailableState("Orders are taken by the shop", why: "Sign in with an owner or staff account to take an order.", symbol: "lock")
            }
        }
        .onAppear { start() }
        .sheet(item: $sizeAsk, onDismiss: {
            if edit != nil && savedEdit { dismiss() }
        }) { ask in NewOrderSizeAskSheet(ask: ask) }
        #if os(macOS)
        // The reader is a window-sized sheet over the form, closed when its reading is filled in.
        .sheet(isPresented: $readingSlip) {
            NavigationStack {
                NewOrderScanScreen(draft: $draft)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { readingSlip = false }
                        }
                    }
            }
            .frame(minWidth: 860, idealWidth: 960, minHeight: 620, idealHeight: 720)
        }
        #else
        .navigationDestination(isPresented: $readingSlip) { NewOrderScanScreen(draft: $draft) }
        #endif
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
        if !loaded && !beginning {
            beginning = true
            // The shop's settings say whether drafts are kept: wait for them (a moment, from the phone's cache).
            if book.settings.loaded {
                begin()
            } else {
                Task {
                    for _ in 0..<30 where !book.settings.loaded { try? await Task.sleep(for: .milliseconds(100)) }
                    begin()
                }
            }
        }
        seedRates()
        settleTakenBy()
        if readsSlip && !readerOpened && created == nil {
            readerOpened = true
            readingSlip = true
        }
    }

    /// What the form opens on, once: blank, with the order this phone was holding made sure of in Drafts (the owner,
    /// 2026-10-25: "don't auto open the draft"); or that very order, when it is continued on purpose. Where the work
    /// has no other place to be found, the phone's copy is continued as it always was: drafts turned off, the demo,
    /// and staff, who cannot read Drafts (firestore.rules).
    private func begin() {
        guard !loaded, edit == nil else { return }
        loaded = true
        Task { await DraftsCount.shared.refresh() }
        let settings = book.settings.value
        let kept = (settings?.autoDraftForms ?? true) && !House.isDemo && session.isOwner
        let saved = NewOrderDraftStore.load(business: biz.id)
        if let saved, resumes || !kept {
            // A form that was typed in while this waited keeps what it has.
            if draft.isBlank {
                draft = saved
                baseline = saved
                restored = true
            }
            Task { await stillOurs() }
            // Work put on the phone's draft by another screen is in Drafts from now, not from its next key.
            if WorkDraftSync.order.id == nil { sync() }
        } else if let saved {
            WorkDraftSync.order.release(business: biz, enabled: kept) { WorkDraftSync.snapshot(saved, settings: settings) }
            NewOrderDraftStore.clear(business: biz.id)
        } else {
            // Nothing kept here: an id left from it is no draft of this form's.
            WorkDraftSync.order.forget(biz.id)
        }
        WorkDraftSync.order.resume()
        seedRates()
        settleTakenBy()
    }

    /// The order kept on this phone is in Drafts too: one saved or thrown away at the counter since is not this
    /// phone's to save a second time, so it goes from here as well.
    private func stillOurs() async {
        guard await WorkDraftSync.order.stillThere(business: biz) == false, created == nil else { return }
        NewOrderDraftStore.clear(business: biz.id)
        WorkDraftSync.order.forget(biz.id)
        draft = NewOrderDraft.fresh()
        restored = false
        editing = nil
        seedRates()
        settleTakenBy()
        tell("Finished on another device", "The order kept on this \(OrderDevice.word) was saved or discarded from Drafts on another device, so it is cleared here. Look for it under Orders.")
    }

    /// The order in Drafts as the web's form holds it, within a third of a second of the last change (`now` as the screen
    /// or the app goes), so it can be finished at the counter (WorkDraftSync).
    private func sync(now: Bool = false) {
        guard loaded, created == nil, edit == nil else { return }
        let d = draft
        let settings = book.settings.value
        WorkDraftSync.order.push(blank: d.isBlank, enabled: settings?.autoDraftForms ?? true, now: now, business: biz) {
            WorkDraftSync.snapshot(d, settings: settings)
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
        #if os(macOS)
        return macScreen(totals, settings)
            .failureAlert($failure, title: failureTitle)
            .confirmDestructive(isPresented: $confirmReset, title: "Start this order over?",
                                message: "Everything typed so far is cleared from this \(OrderDevice.word) and from Drafts.",
                                action: "Start over") { startOver() }
            .interactiveDismissDisabled(saving)
            .moneyFeedback(success: saves, failure: 0)
            .modifier(keeping)
        #else
        return screen(totals, settings)
            .failureAlert($failure, title: failureTitle)
            .confirmDestructive(isPresented: $confirmReset, title: "Start this order over?",
                                message: "Everything typed so far is cleared from this \(OrderDevice.word) and from Drafts.",
                                action: "Start over") { startOver() }
            .interactiveDismissDisabled(saving)
            // A refused save already gets the error tap from failureAlert; this is the success tap for the money.
            .moneyFeedback(success: saves, failure: 0)
            .modifier(keeping)
        #endif
    }

    /// The form, its bar and its toolbar.
    private func screen(_ totals: NewOrderMath.Totals, _ settings: Settings?) -> some View {
        TransactionWorkspace {
          VStack(spacing: 0) {
            EntrySteps(selection: $step, states: stepStates)
            if step == .pieces || step == .payment { NewOrderPinnedSummary(totals: totals) }
            // Only the step's own form is keyed: the strip and the pinned total stay, the step cross-fades.
            Form { Group {
            if restored { restoredBanner }
            if edit?.invoiced == true {
                Section {
                    Label("This order is on an invoice already. The invoice keeps its own copy of the pieces and the money: change those on the invoice.", systemImage: "doc.text")
                        .font(.subheadline)
                }
            }
            switch step {
            case .customer:
                if edit == nil && draft.isBlank { DraftsNote() }
                NewOrderCustomerSection(draft: $draft, people: people, takenBy: session.shop.takenBy) {
                    CustomerField.recent(invoices: book.invoices.items, orders: book.orders.items, book: book.customers.items)
                }
                NewOrderPromisedSection(draft: $draft)
            case .pieces:
                if ratesFirst { NewOrderRatesSection(draft: $draft, settings: settings) }
                piecesSection(totals)
                if !ratesFirst { NewOrderRatesSection(draft: $draft, settings: settings) }
                NewOrderPrintedSection(draft: $draft)
            case .payment:
                NewOrderPaymentSection(draft: $draft, totals: totals)
                NewOrderExchangeSection(draft: $draft)
            case .review:
                NewOrderTotalsSection(totals: totals, pieces: draft.pieces.count)
                Section {
                    LabeledContent("Customer", value: draft.customerName.isEmpty ? "Walk-in" : draft.customerName)
                    if !draft.customerPhone.isEmpty { LabeledContent("Phone", value: draft.customerPhone) }
                    LabeledContent("Promised for", value: draft.promised.isEmpty ? "No date" : ShopDate.say(draft.promised))
                    Button("Edit \(NewOrderFormat.pieces(draft.pieces.count))") { step = .pieces }
                    Button("Edit payment and exchange") { step = .payment }
                } header: { LedgerHeading(title: "Review") }
                if !draft.pieces.isEmpty {
                    Section {
                        ForEach(Array(draft.pieces.enumerated()), id: \.element.id) { index, piece in
                            Button { editing = NewOrderPieceRef(id: piece.id) } label: {
                                NewOrderPieceRow(piece: piece, number: index + 1, price: index < totals.prices.count ? totals.prices[index] : 0)
                            }.buttonStyle(.plain)
                        }
                    } header: { LedgerHeading(title: "Pieces") }
                }
                tail(totals, settings)
            }
            }
            .houseRows()
            }
            .id(step)
            .transition(.opacity)
          }
          .motion(step)
          .formColumn()
        } review: {
            TransactionReview(customer: draft.customerName, contact: draft.customerPhone,
                pieces: draft.pieces.enumerated().map { index, p in
                    TransactionReviewRow(label: "\(index + 1). \(p.description.isEmpty ? "Untitled piece" : p.description)",
                                         value: Money.pkr(index < totals.prices.count ? totals.prices[index] : 0))
                }, figures: [
                    TransactionReviewRow(label: "Estimate", value: Money.pkr(totals.subtotal)),
                    TransactionReviewRow(label: "Discount", value: Money.pkr(totals.discount)),
                    TransactionReviewRow(label: "Advance", value: Money.pkr(totals.advance)),
                    TransactionReviewRow(label: "Exchange", value: Money.pkr(totals.exchange)),
                    TransactionReviewRow(label: totals.balance < 0 ? "Credit to customer" : "Balance due", value: Money.pkr(abs(totals.balance)))
                ])
        } footer: {
            if step == .review { saveBar(totals) }
            else { EntryContinue(selection: $step) }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(edit.map { "Edit \($0.orderId)" } ?? "New order")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // The AI slip reader (NewOrderScanScreen): the ERP's own reader, its answer laid into this draft.
            // Only an owner's sign-in may use the reader, so only an owner is offered it.
            if edit == nil && session.isOwner {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { readingSlip = true } label: {
                        Label("Read a slip", systemImage: "doc.text.viewfinder")
                            .labelStyle(.titleAndIcon)
                    }
                }
            }
            if edit == nil {
                // Throwing the order away is a menu's item, not a red button in the form.
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button(role: .destructive) { confirmReset = true } label: {
                            Label("Start over", systemImage: "arrow.counterclockwise")
                        }
                        .disabled(draft.isBlank)
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        .keyboardDone()
        // ⌘S saves from any step; a step still missing something is told what, as the Save button would.
        .background {
            Button("Save") { Task { await save() } }
                .keyboardShortcut("s", modifiers: .command).opacity(0).accessibilityHidden(true)
        }
        .navigationDestination(item: $editing) { ref in editor(ref.id) }
    }

    /// Where each step stands, read from the draft only: a tick when it is complete, an amber dot when what is
    /// typed would stop the save (the same rules as `NewOrderMath.problem`).
    private var stepStates: [EntryStep: EntryStepState] {
        var out: [EntryStep: EntryStepState] = [:]
        if !draft.customerName.trimmingCharacters(in: .whitespaces).isEmpty { out[.customer] = .done }
        if !draft.pieces.isEmpty {
            let complete = draft.pieces.allSatisfy { (p: NewOrderPieceDraft) in
                p.description.trimmingCharacters(in: .whitespaces).count >= 3
                    && (p.manual ? NewOrderFormat.num(p.manualPrice) > 0 : NewOrderFormat.num(p.weight) > 0)
            }
            out[.pieces] = complete ? .done : .attention
        }
        if NewOrderFormat.num(draft.discount) < 0 || NewOrderFormat.num(draft.advance) < 0 {
            out[.payment] = .attention
        } else if NewOrderFormat.num(draft.advance) > 0 {
            out[.payment] = .done
        }
        return out
    }

    /// Kept on this phone and in Drafts at every change, and at once when the app leaves or the screen goes.
    private var keeping: NewOrderKeeping {
        NewOrderKeeping(
            draft: draft,
            settingsValue: book.settings.value,
            changed: { changed($0) },
            keep: { keepNow() },
            seed: { seedRates() }
        )
    }

    /// Any change to the form is on the phone at once (written off the main thread, the newest of a burst) and in
    /// Drafts within a third of a second: a customer's name alone is worth keeping (NewOrderDraft.isBlank).
    private func changed(_ d: NewOrderDraft) {
        // An edit is never kept on the phone or in Drafts: the order on file is the copy.
        guard loaded, created == nil, edit == nil else { return }
        // The draft just opened is not a change to it.
        if let baseline { if d == baseline { return }; self.baseline = nil }
        NewOrderDraftStore.save(d, business: biz.id)
        sync()
    }

    private func keepNow() {
        guard loaded, created == nil, edit == nil else { return }
        // A draft opened and left as it was has nothing new to keep.
        if let baseline, draft == baseline { return }
        NewOrderDraftStore.save(draft, now: true, business: biz.id)
        sync(now: true)
    }

    private var restoredBanner: some View {
        Section {
            if draft.fromSale {
                Label("These are the pieces of your sale. Once this order is saved they leave the sale.", systemImage: "arrow.right.circle")
                    .font(.subheadline)
            } else {
                Label("Your order in progress is back. It was kept on this \(OrderDevice.word).", systemImage: "arrow.uturn.backward.circle")
                    .font(.subheadline)
            }
            if draft.photosLeftOut {
                Label("The sample photos were too many to keep: add them again.", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(Tone.owed.color)
            }
        }
        .motion(draft.photosLeftOut)
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
                    .tint(Tone.working.color)
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
        .motion(draft.pieces.map(\.id))
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
        Motion.run(reduce: reduceMotion) { draft.duplicatePiece(id) }
    }

    private func removePiece(_ id: UUID) {
        Motion.run(reduce: reduceMotion) { draft.pieces.removeAll { $0.id == id } }
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
                onRemove: { removePiece(id) },
                editingOrder: edit != nil
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
    }

    private func startOver() {
        NewOrderDraftStore.clear(business: biz.id)
        WorkDraftSync.order.drop(business: biz)
        draft = NewOrderDraft.fresh()
        restored = false
        editing = nil
        step = .customer
        seedRates()
        settleTakenBy()
    }

    // MARK: Saving

    /// THE action of the screen: Save, with the balance in the line above it.
    private func saveBar(_ totals: NewOrderMath.Totals) -> some View {
        let word = totals.balance < 0 ? "Credit to customer " : "Balance due "
        return VStack(spacing: 0) {
            UpdateBanner()
            ActionBar(
                primary: .init(edit == nil ? "Save order" : "Save changes", isBusy: saving, isDisabled: UpdateGate.blocked) { Task { await save() } },
                summary: word + Money.pkr(abs(totals.balance))
            )
        }
        .padding(.top, pt(8))
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
                _ = try await ERPAPI.shared.write("updateOrder", request, business: biz)
                savedEdit = true
                saves += 1
                if let order = request["order"] as? [String: Any] { offerSizes(order) }
                if sizeAsk == nil { dismiss() }
            } catch let e as ERPAPI.Failure {
                tell("The changes weren't saved", e.message)
            } catch {
                tell("The changes weren't saved", error.localizedDescription + "\n\nIf the connection dropped, the changes may have been saved. Check the order before saving again.")
            }
            return
        }
        let request = NewOrderMath.request(draft, settings: settings, customers: people)
        do {
            let out = try await ERPAPI.shared.write("createOrder", request, business: biz)
            guard let made = out["order"] as? [String: Any], let id = made["id"] as? String, !id.isEmpty else {
                throw ERPAPI.Failure(status: 0, message: "The ERP saved the order but didn't say its number. Look for it in Orders.")
            }
            NewOrderDraftStore.clear(business: biz.id)
            WorkDraftSync.order.drop(business: biz)
            // Made from the sale in progress: the pieces are the order's now, and leaving them on the sale would
            // bill the same pieces a second time (the web clears the cart).
            if draft.fromSale {
                SaleDraftStore.clear(business: biz.id)
                WorkDraftSync.sale.drop(business: biz)
            }
            saves += 1
            offerSizes(made)
            // Blank, so a keep that was already on its way writes nothing back. The form gives way to the order with no
            // animation: its glass Save button can't fade and would shrink into a "bubble" over the order.
            var still = Transaction()
            still.disablesAnimations = true
            withTransaction(still) {
                draft = NewOrderDraft.fresh()
                created = id
            }
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

/// The order is kept as it is typed (NewOrderDraftStore, WorkDraftSync): at every change, and at once when the app
/// leaves (scenePhase: the home screen, the app switcher, a call) or the screen goes (back, or a sheet swiped down).
/// It also seeds the rates when the shop's settings arrive. Its own modifier so the form's chain of modifiers stays
/// short for the compiler.
struct NewOrderKeeping: ViewModifier {
    let draft: NewOrderDraft
    let settingsValue: Settings?
    let changed: (NewOrderDraft) -> Void
    let keep: () -> Void
    let seed: () -> Void

    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .onChange(of: draft) { _, new in changed(new) }
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
                .environment(\.zoomNamespace, nil)  // swapped in place after a save: no row to zoom from
        } else {
            VStack(spacing: pt(12)) {
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

/// The order's total and what is still due, pinned under the steps while pieces and payment are typed. The
/// figures are `NewOrderMath.totals`' own (subtotal and balance), never worked out again here.
private struct NewOrderPinnedSummary: View {
    let totals: NewOrderMath.Totals

    private var dueTone: Tone {
        if totals.balance <= -1 { return .credit }
        return totals.balance >= 1 ? .owed : .settled
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: pt(12)) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Order total").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                Text(Money.pkr(totals.subtotal))
                    .font(.system(.title3, design: .serif).weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: totals.subtotal))
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 0) {
                Text(isCredit(totals.balance) ? "Credit to customer" : "Due").font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                Text(Money.pkr(abs(totals.balance)))
                    .font(.headline)
                    .monospacedDigit()
                    .foregroundStyle(dueTone.color)
                    .contentTransition(.numericText(value: totals.balance))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .padding(.horizontal, pt(16)).padding(.vertical, pt(8))
        .background(Theme.ground)
        .motion(totals.balance, Motion.travel)
        .motion(totals.subtotal, Motion.travel)
        .accessibilityElement(children: .combine)
    }
}

#if os(macOS)
// MARK: The Mac's form: one window

/// New order and Edit order on a Mac are one window form: the phone's steps are the form's sections, one after the
/// other, and the order's summary (who, the pieces and their prices, the money) stays in a column on the right while
/// they are filled in. Save is the footer's default button (Return, or ⌘S from anywhere); a piece opens in a sheet.
extension NewOrder {
    fileprivate func macScreen(_ totals: NewOrderMath.Totals, _ settings: Settings?) -> some View {
        let word = totals.balance < 0 ? "Credit to customer " : "Balance due "
        return HStack(spacing: 0) {
            Form {
                Group {
                    if restored { restoredBanner }
                    // Change rate (the order page's, "?rates=1"): the rates at the top of the one form.
                    if ratesFirst { NewOrderRatesSection(draft: $draft, settings: settings) }
                    if edit?.invoiced == true {
                        Section {
                            Label("This order is on an invoice already. The invoice keeps its own copy of the pieces and the money: change those on the invoice.", systemImage: "doc.text")
                                .font(.subheadline)
                        }
                    }
                    if edit == nil && draft.isBlank { DraftsNote() }
                    NewOrderCustomerSection(draft: $draft, people: people, takenBy: session.shop.takenBy) {
                        CustomerField.recent(invoices: book.invoices.items, orders: book.orders.items, book: book.customers.items)
                    }
                    NewOrderPromisedSection(draft: $draft)
                    piecesSection(totals)
                    if !ratesFirst { NewOrderRatesSection(draft: $draft, settings: settings) }
                    NewOrderPrintedSection(draft: $draft)
                    NewOrderPaymentSection(draft: $draft, totals: totals)
                    NewOrderExchangeSection(draft: $draft)
                    tail(totals, settings)
                }
                .houseRows()
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Theme.ground)
            .frame(minWidth: 460, maxWidth: .infinity)
            Divider()
            VStack(spacing: 0) {
                UpdateBanner()
                ScrollView {
                    TransactionReview(customer: draft.customerName, contact: draft.customerPhone,
                        pieces: draft.pieces.enumerated().map { index, p in
                            TransactionReviewRow(label: "\(index + 1). \(p.description.isEmpty ? "Untitled piece" : p.description)",
                                                 value: Money.pkr(index < totals.prices.count ? totals.prices[index] : 0))
                        }, figures: [
                            TransactionReviewRow(label: "Estimate", value: Money.pkr(totals.subtotal)),
                            TransactionReviewRow(label: "Discount", value: Money.pkr(totals.discount)),
                            TransactionReviewRow(label: "Advance", value: Money.pkr(totals.advance)),
                            TransactionReviewRow(label: "Exchange", value: Money.pkr(totals.exchange)),
                            TransactionReviewRow(label: totals.balance < 0 ? "Credit to customer" : "Balance due", value: Money.pkr(abs(totals.balance)))
                        ])
                        .padding(20)
                }
            }
            .frame(width: 330)
            .background(Theme.ground)
        }
        .actionBar(primary: .init(edit == nil ? "Save order" : "Save changes", isBusy: saving, isDisabled: UpdateGate.blocked) { Task { await save() } },
                   summary: word + Money.pkr(abs(totals.balance)))
        .navigationTitle(edit.map { "Edit \($0.orderId)" } ?? "New order")
        .toolbar {
            // The AI slip reader: only an owner's sign-in may use it, so only an owner is offered it.
            if edit == nil && session.isOwner {
                ToolbarItem(placement: .primaryAction) {
                    Button { readingSlip = true } label: {
                        Label("Read a slip", systemImage: "doc.text.viewfinder").labelStyle(.titleAndIcon)
                    }
                    .help("Read a photographed slip into this order")
                }
            }
            if edit == nil {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button(role: .destructive) { confirmReset = true } label: {
                            Label("Start over", systemImage: "arrow.counterclockwise")
                        }
                        .disabled(draft.isBlank)
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        // \u{2318}S saves from anywhere; a form missing something is told what, as the Save button would.
        .background {
            Button("Save") { Task { await save() } }
                .keyboardShortcut("s", modifiers: .command).opacity(0).accessibilityHidden(true)
        }
        .sheet(item: $editing) { ref in
            NavigationStack { editor(ref.id) }
                .frame(minWidth: 820, idealWidth: 900, minHeight: 640, idealHeight: 720)
        }
    }
}
#endif
