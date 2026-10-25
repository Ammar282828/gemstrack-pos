import SwiftUI
import ERPCore

/// A new sale (src/components/sale/sale-page.tsx, `/invoices/new`): the customer, the pieces, the
/// rates, a discount, what is handed over in exchange, what is paid now, and the shop's own notes,
/// then Save, which the ERP writes as the browser does (`createInvoice`, lib/writes/create-invoice.ts)
/// and opens the invoice.
///
/// A piece that was never in stock is described on the spot ("New item", a NEW- key that is not a stock
/// number); the server sells it without a stock check and refuses it only if it was sold already.
///
/// What stays the ERP's page: editing an invoice, reading a written bill with the AI scanner, and
/// adding a piece to stock. Owners only, as the ERP's write is.
///
/// An unfinished sale is kept at every change, on this phone (UserDefaults "erp.saleDraft") and in the ERP's Drafts, in
/// the sale page's own shape, so the counter can finish it (WorkDraftSync, SaleWebDraft). "Start over" empties both.
/// A New sale always opens blank: the one kept before is in Drafts, continued from there or from a screen that puts a
/// piece on it and opens this with `?resume=1` (Scan, Stock).
struct NewSale: View {
    @Environment(Session.self) private var session
    /// Opened from the New chooser's Read a written bill: the reader comes up over the form, once.
    var readsBill = false
    /// Opened to continue the sale kept on this phone (`?resume=1`); otherwise the form is blank.
    var resumes = false

    var body: some View {
        if session.isOwner {
            SaleForm(startsReading: readsBill, resumes: resumes)
        } else {
            ownersOnly
        }
    }

    /// Staff cannot make a sale in the browser either (the ERP's write is for owners).
    private var ownersOnly: some View {
        ContentUnavailableView {
            Label("Sales are for the owners", systemImage: "lock")
        } description: {
            Text("The ERP doesn't let staff make a sale either. You can take an order or a repair, or take a payment on an invoice.")
        } actions: {
            NavigationLink(value: Route(path: "/orders/add")) { Text("New order") }
            NavigationLink(value: Route(path: "/invoices")) { Text("Invoices") }
        }
        .navigationTitle("New sale")
        .navigationBarTitleDisplayMode(.inline)
    }
}

@MainActor
struct SaleForm: View {
    @Environment(Book.self) var book
    @Environment(Session.self) var session
    @Environment(\.dismiss) var dismiss
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.scenePhase) var scenePhase

    /// Edit invoice (SaleEdit): the invoice on file in this form. Nothing is kept on the phone or in Drafts,
    /// there is no starting over, and Save writes the invoice under its own number.
    var edit: SaleEdit? = nil
    /// The AI bill reader opens over the form when it first shows (NewSale.readsBill).
    var startsReading = false
    /// The sale kept on this phone is continued rather than a blank one (NewSale.resumes).
    var resumes = false
    /// The first appearance has decided what the form opens on; later ones only read the phone's copy again.
    @State var begun = false
    /// The draft this form was opened on, until the first change: opening a draft is not a change to it.
    @State var baseline: SaleDraft?
    /// Change rate opens an invoice on file at the Pieces step, its rates on top (the owner, 2026-10-24).
    var ratesFirst = false
    @State var ratesOpened = false
    @State var readerOpened = false
    @State var readingBill = false
    /// The invoice has been put in the form, once (a change arriving meanwhile must not undo what is typed).
    @State var editLoaded = false

    /// The business this sale was opened in: its draft, Drafts copy and save go to it, whatever is open later.
    @State var biz = House.business
    @State var draft = SaleDraft()
    @State var query = ""
    @State var notice: String?
    @State var editing: SaleLine?
    /// A piece being described that is not on the sale yet.
    @State var newItem: SaleLine?
    @State var step: EntryStep = .customer
    @State var scanning = false
    @State var rateSheet = false
    @State var confirmingReset = false
    @State var saving = false
    @State var failure: String?
    @State var goneSkus: [String] = []
    /// The server refused a piece described for this bill because it was sold already: the sale was saved before.
    @State var alreadySold = false
    /// The invoice just saved: the screen is replaced by it.
    @State var made: String?
    /// Exchange rows whose weight and rate are open.
    @State var openedExchange: Set<String> = []
    @State var marginShown = false
    /// Taken by starts on this account's counter name once, for a new sale (decisions.md "Signed-in defaults").
    @State var takenByStarted = false
    /// The rates typed on the sale, sent back to the shop's after the sale saved, did not go: said quietly.
    @State var ratesNote: Note?
    /// The order form, opened from this sale's pieces.
    @State var openOrder: Route?
    @State var confirmingOrder = false

    var body: some View {
        Group {
            if let id = made {
                InvoiceScreen(id: id)
                    .environment(\.zoomNamespace, nil)  // swapped in place after a save: no row to zoom from
            } else if !book.settings.loaded {
                SkeletonLoading().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                #if os(macOS)
                macPage
                #else
                page
                #endif
            }
        }
        .navigationTitle(edit.map { "Edit \($0.invoiceId)" } ?? "New sale")
        .navigationBarTitleDisplayMode(.inline)
        .noteToast($ratesNote)
        // The sale made: the form gives way to its invoice at once, with a tick felt as it lands. Not on a curve:
        // the form's Save button is Liquid Glass, which can't fade, so an animated swap shrank it into a "bubble"
        // over the new invoice (owner, 2026-10-17: "that bubble bug on form completion").
        // The error tap comes with the failure alert, so only the success half is wired here.
        .moneyFeedback(success: made, failure: false)
        .task {
            book.settings.need()
            book.products.need()
            book.customers.need()
            book.invoices.need()
            if ratesFirst && edit != nil && !ratesOpened {
                ratesOpened = true
                step = .pieces
            }
        }
    }

    // MARK: The page

    private var page: some View {
        let f = SaleFigures(draft: draft, settings: book.settings.value, customers: book.customers.items, marginSettings: House.margin)
        return TransactionWorkspace {
          VStack(spacing: 0) {
            EntrySteps(selection: $step, states: stepStates(f))
            if step == .pieces || step == .payment { saleSummary(f) }
            Form { Group {
            if let edit {
                Section {
                    Label(edit.paidBefore > 0
                          ? "\(Money.pkr(edit.paidBefore)) paid before stays on \(edit.invoiceId). A payment added below is taken now. A piece taken off stays sold."
                          : "Nothing is paid on \(edit.invoiceId) yet. A payment added below is taken now. A piece taken off stays sold.",
                          systemImage: "pencil.and.list.clipboard")
                        .font(.subheadline)
                }
            }
            switch step {
            case .customer:
                if edit == nil && draft.isBlank { DraftsNote() }
                customerSection(f)
            case .pieces:
                if ratesFirst { ratesSection(f) }
                piecesSection(f)
                if !ratesFirst { ratesSection(f) }
            case .payment:
                discountSection(f)
                exchangeSection()
                paymentSection(f)
            case .review:
                // The sum first: it is what the customer is told.
                totalsSection(f)
                Section {
                    LabeledContent("Customer", value: f.who.name.isEmpty ? "Walk-in" : f.who.name)
                    if !draft.customerPhone.isEmpty { LabeledContent("Phone", value: draft.customerPhone) }
                    Button("Edit pieces") { step = .pieces }
                    Button("Edit payment and exchange") { step = .payment }
                } header: { LedgerHeading(title: "Review") }
                if !draft.lines.isEmpty {
                    Section {
                        ForEach(draft.lines) { line in lineButton(line, f) }
                    } header: { LedgerHeading(title: "Pieces") }
                }
                shopSection(f)
                deliverySection(f)
                orderSection()
            }
            }
            .houseRows()
            }
            .id(step)
            .transition(.opacity)
          }
          .motion(step, Motion.enter)
          .formColumn()
        } review: {
            TransactionReview(customer: f.who.name, contact: draft.customerPhone,
                pieces: draft.lines.enumerated().map { index, line in
                    TransactionReviewRow(label: "\(index + 1). \(line.name)", value: f.hasEstimate ? Money.pkr(f.price(of: line.sku)) : "Pending rates")
                }, figures: [
                    TransactionReviewRow(label: "Subtotal", value: f.hasEstimate ? Money.pkr(f.subtotal) : "Pending rates"),
                    TransactionReviewRow(label: "Discount", value: Money.pkr(f.discount)),
                    TransactionReviewRow(label: "Exchange", value: Money.pkr(f.exchange)),
                    TransactionReviewRow(label: "Paid now", value: Money.pkr(f.paidNow)),
                    TransactionReviewRow(label: f.balance < 0 ? "Credit to customer" : "Balance due", value: f.hasEstimate ? Money.pkr(abs(f.balance)) : "Pending rates")
                ])
        } footer: {
            if step == .review { saveBar(f) }
            else { EntryContinue(selection: $step) }
        }
        .scrollDismissesKeyboard(.interactively)
        .keyboardDone()
        // ⌘S saves from any step (save(f) does nothing until the sale can be saved).
        .background {
            Button("Save") { Task { await save(f) } }
                .keyboardShortcut("s", modifiers: .command).opacity(0).accessibilityHidden(true)
        }
        .failureAlert($failure, title: "About this sale")
        .toolbar {
            // The AI bill reader (SaleScanScreen), up where New order puts its slip reader.
            ToolbarItem(placement: .topBarTrailing) {
                Button { readingBill = true } label: {
                    Label("Read a written bill", systemImage: "camera.viewfinder")
                        .labelStyle(.titleAndIcon)
                }
            }
            if edit == nil {
                // Throwing the sale away is a menu's item, not a red button beside the title.
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button(role: .destructive) { confirmingReset = true } label: {
                            Label("Start over", systemImage: "arrow.counterclockwise")
                        }
                        .disabled(draft.isBlank)
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                }
            }
        }
        .sheet(item: $editing) { line in
            SaleLineEditor(line: line, rates: f.rateBook.pricing) { changed in replace(line.sku, with: changed) }
        }
        .sheet(item: $newItem) { line in
            SaleLineEditor(line: line, rates: f.rateBook.pricing, create: true) { made in addNew(made) }
        }
        .sheet(isPresented: $scanning) {
            SaleScanSheet { code in scanned(code) }
                .presentationSizing(.page)
        }
        .sheet(isPresented: $rateSheet) { RateSheet() }
        .confirmDestructive(isPresented: $confirmingReset, title: "Start over?",
                            message: "This empties the sale on this phone and takes it out of Drafts: the pieces, the customer and everything typed.",
                            action: "Start over") { startOver() }
        .confirmDestructive(isPresented: $confirmingOrder, title: "Replace the order in progress?",
                            message: "An order is half typed on this phone. Making one from these pieces replaces it.",
                            action: "Replace it") { createOrder() }
        // This phone's own unfinished sale, written at every change. The scan screen can add a piece to it while this
        // one waits underneath, so it is read again whenever the screen appears (`appeared`).
        .onAppear { appeared() }
        // Kept at once on the phone and in Drafts within a third of a second (WorkDraftSync), and at once as the app
        // leaves (scenePhase) or the screen goes (back, or a sheet swiped down).
        .onChange(of: draft) { _, new in changed(new) }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { keepNow() }
        }
        .onDisappear { keepNow() }
        .onChange(of: query) { _, _ in notice = nil }
        // "Create order": the order form opens on this sale's pieces (NewOrderDraftStore.startFromSale).
        .navigationDestination(item: $openOrder) { r in
            ScreenRegistry.view(for: r.path)
        }
        .navigationDestination(isPresented: $readingBill) {
            SaleScanScreen(draft: $draft, keep: edit == nil)
        }
    }

    /// Any change to the sale is on the phone at once and in Drafts within a third of a second. A customer's name alone
    /// is worth keeping (SaleDraft.isBlank).
    func changed(_ d: SaleDraft) {
        // An edit is never kept on the phone or in Drafts: the invoice on file is the copy.
        guard edit == nil, takenByStarted, made == nil else { return }
        // The draft just opened is not a change to it.
        if let baseline { if d == baseline { return }; self.baseline = nil }
        SaleDraftStore.save(d, business: biz.id)
        sync(d)
    }

    /// The unfinished sale, written now (the app leaving, the screen going).
    func keepNow() {
        guard made == nil, edit == nil, takenByStarted else { return }
        // A draft opened and left as it was has nothing new to keep.
        if let baseline, draft == baseline { return }
        SaleDraftStore.save(draft, business: biz.id)
        sync(draft, now: true)
    }

    /// The counter name Taken by starts on: this account's, when it has one on the house's list.
    var defaultTaker: String { session.shop.person ?? "" }

    /// Every time the screen shows. The first time decides what the form opens on (`begin`): blank, or the sale kept
    /// on this phone when it is continued on purpose. After that this phone's copy is read again (the scan screen can
    /// add a piece to it while this one waits underneath); a sale cleared elsewhere (an order made from its pieces)
    /// starts afresh. A brand-new sale starts Taken by on the signed-in person, once.
    func appeared() {
        if let edit {
            if !editLoaded {
                draft = edit.draft
                editLoaded = true
            }
            return
        }
        if !begun {
            begun = true
            begin()
        } else if let stored = SaleDraftStore.load(business: biz.id) {
            var kept = stored
            if kept.takenBy.isEmpty && !takenByStarted { kept.takenBy = defaultTaker }
            if kept != draft { draft = kept }
            if !stored.isBlank { Task { await stillOurs() } }
        } else if !draft.isBlank {
            draft = SaleDraft()
            draft.takenBy = defaultTaker
        } else if !takenByStarted {
            draft.takenBy = defaultTaker
        }
        takenByStarted = true
        if startsReading && !readerOpened {
            readerOpened = true
            readingBill = true
        }
    }

    /// What the form opens on, once (the owner, 2026-10-25: "don't auto open the draft"): blank, with the sale this
    /// phone was holding made sure of in Drafts; or that very sale, when it is continued on purpose (`?resume=1`:
    /// a piece put on it by Scan or Stock, Drafts' Continue).
    /// Where the work has no other place to be found, the phone's copy is continued as it always was: drafts turned
    /// off, and the demo.
    func begin() {
        Task { await DraftsCount.shared.refresh() }
        let settings = book.settings.value
        let enabled = (settings?.autoDraftForms ?? true) && !House.isDemo
        if let stored = SaleDraftStore.load(business: biz.id) {
            if resumes || !enabled {
                var kept = stored
                if kept.takenBy.isEmpty { kept.takenBy = defaultTaker }
                draft = kept
                baseline = kept
                // Work put on the phone's draft by another screen is in Drafts from now, not from its next key.
                if WorkDraftSync.sale.id == nil { sync(kept) }
                if !stored.isBlank { Task { await stillOurs() } }
                return
            }
            let customers = book.customers.items
            WorkDraftSync.sale.release(business: biz, enabled: enabled) {
                WorkDraftSync.snapshot(stored, settings: settings, customers: customers)
            }
            SaleDraftStore.clear(business: biz.id)
        } else {
            // Nothing kept here: an id left from it is no draft of this form's.
            WorkDraftSync.sale.forget(biz.id)
        }
        draft = SaleDraft()
        draft.takenBy = defaultTaker
        WorkDraftSync.sale.resume()
    }

    /// The sale in Drafts as the web's sale page holds it, within a third of a second of the last change (`now` as the
    /// screen goes), so it can be finished at the counter (WorkDraftSync).
    func sync(_ d: SaleDraft, now: Bool = false) {
        let settings = book.settings.value
        let customers = book.customers.items
        WorkDraftSync.sale.push(blank: d.isBlank, enabled: settings?.autoDraftForms ?? true, now: now, business: biz) {
            WorkDraftSync.snapshot(d, settings: settings, customers: customers)
        }
    }

    /// The sale kept on this phone is in Drafts too: one invoiced or thrown away at the counter since is not
    /// this phone's to bill a second time, so it goes from here as well.
    func stillOurs() async {
        guard await WorkDraftSync.sale.stillThere(business: biz) == false, made == nil else { return }
        SaleDraftStore.clear(business: biz.id)
        WorkDraftSync.sale.forget(biz.id)
        startOver()
        #if os(macOS)
        failure = "The sale kept on this Mac was invoiced or discarded from Drafts on another device, so it is cleared here. Look for it under Invoices."
        #else
        failure = "The sale kept on this phone was invoiced or discarded from Drafts on another device, so it is cleared here. Look for it under Invoices."
        #endif
    }

    // MARK: Actions

    func pickCustomer(_ c: Customer?) { draft.pick(c) }

    func replace(_ sku: String, with line: SaleLine) {
        if let i = draft.lines.firstIndex(where: { $0.sku == sku }) { draft.lines[i] = line }
    }

    func remove(_ sku: String) {
        draft.lines.removeAll { $0.sku == sku }
    }

    func add(_ p: Product) {
        if draft.lines.contains(where: { $0.sku == p.sku }) {
            notice = "\(p.name) is already on this sale."
            return
        }
        draft.lines.append(SaleLine(p))
        query = ""
        notice = nil
    }

    /// Return in the search box: the piece typed exactly, else the only one the search found. Nothing
    /// found is a piece that was never in inventory: the web opens a new item with what was typed as its
    /// name, so it can be billed directly (handleAddBySku). A SKU that was sold is said so instead.
    func addTyped() {
        let typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if typed.isEmpty { return }
        if let p = SaleLookup.find(typed, in: book.products.items) {
            add(p)
            return
        }
        let found = SaleLookup.matches(typed, in: book.products.items, excluding: Set(draft.lines.map { $0.sku }))
        if found.count == 1 {
            add(found[0])
        } else if found.isEmpty {
            if let inv = SaleLookup.soldOn(typed, invoices: book.invoices.items) {
                notice = "\(typed) was sold on \(inv.id)."
            } else {
                startNewItem(named: typed)
                query = ""
            }
        }
    }

    /// "New item": a blank piece to describe (edit-cart-item-dialog.tsx `blankCartItem`), added to the
    /// sale when it is saved from the sheet.
    func startNewItem(named name: String = "") {
        var line = SaleLine(blankFor: House.metal, sku: SaleLine.newItemSku(avoiding: Set(draft.lines.map { $0.sku })))
        line.name = name
        newItem = line
    }

    func addNew(_ line: SaleLine) {
        if !draft.lines.contains(where: { $0.sku == line.sku }) { draft.lines.append(line) }
    }

    func notInStock(_ sku: String) -> String {
        if let inv = SaleLookup.soldOn(sku, invoices: book.invoices.items) { return "\(sku) was sold on \(inv.id)." }
        return "No piece \(sku) in stock."
    }

    /// A tag read by the camera or typed: what became of it, in a sentence.
    func scanned(_ code: String) -> (said: String, added: Bool) {
        let sku = TagCode.sku(from: code)
        guard let p = SaleLookup.find(sku, in: book.products.items) else { return (notInStock(sku), false) }
        if draft.lines.contains(where: { $0.sku == p.sku }) { return ("\(p.name) is already on this sale.", false) }
        draft.lines.append(SaleLine(p))
        return ("Added \(p.name) (\(p.sku)).", true)
    }

    func startOver() {
        SaleDraftStore.clear(business: biz.id)
        WorkDraftSync.sale.drop(business: biz)
        draft = SaleDraft()
        draft.takenBy = defaultTaker
        query = ""
        notice = nil
        failure = nil
        goneSkus = []
        alreadySold = false
        openedExchange = []
        step = .customer
    }
}

// MARK: - The Mac: one window

#if os(macOS)
/// New sale and Edit invoice on the Mac (docs/features/mac-design.md, "New sale"): a document window of three regions.
/// The stock at the left (SaleMacKit.swift: the scanner's box and the stock table, put away with the toolbar's button), the
/// bill in the centre (its pieces as a table, its totals under it), the sale's panel at the right (Mac/Places/Sale/
/// SaleMacPanel.swift), and under all three the footer: what blocks saving or the balance, and Save. The steps of the
/// phone are sections of the panel here; every action is SaleForm's own.
extension SaleForm {
    @ViewBuilder
    var macPage: some View {
        let f = SaleFigures(draft: draft, settings: book.settings.value, customers: book.customers.items, marginSettings: House.margin)
        SaleMacHost(ratesFirst: ratesFirst) { ui in
            let actions = macActions(f, ui)
            macWired(macLayout(f, ui, actions), f, actions, ui)
        }
    }

    // MARK: The three regions

    private func macLayout(_ f: SaleFigures, _ ui: SaleMacUI, _ actions: SaleMacActions) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                HSplitView {
                    if ui.stockShown {
                        macStock(f, ui)
                            .frame(minWidth: 280, idealWidth: 340, maxWidth: 420)
                    }
                    macBill(f, ui)
                        .frame(minWidth: 320, maxWidth: .infinity)
                }
                Divider()
                // 320 when the window has room, down to 280 when it has not (the window may shrink to 600 with the stock put away).
                macPanel(f, ui)
                    .frame(minWidth: 280, idealWidth: 320, maxWidth: 320)
            }
            macFooter(f, actions)
        }
        .background(Theme.ground)
    }

    private func macStock(_ f: SaleFigures, _ ui: SaleMacUI) -> some View {
        SaleMacStock(
            products: book.products.items,
            revision: book.products.revision,
            taken: Set(draft.lines.map { $0.sku }),
            pricing: f.rateBook.pricing,
            query: $query,
            notice: notice,
            focusAsks: ui.scannerAsks,
            add: { add($0) },
            submit: { addTyped() },
            saveWhenEmpty: { if f.canSave && !UpdateGate.blocked { Task { await save(f) } } },
            scan: { scanning = true },
            newItem: { startNewItem() })
    }

    /// The bill. A piece's editor is the existing SaleLineEditor in a popover on the table (double-click, Return or Edit
    /// Piece…); a piece that was never in stock (New Item…) opens the same editor there.
    private func macBill(_ f: SaleFigures, _ ui: SaleMacUI) -> some View {
        SaleMacBill(
            lines: draft.lines,
            figures: f,
            spec: { spec($0) },
            isGone: { line in book.products.loaded && !line.isOneOff && book.products.item(line.sku) == nil },
            picked: Bindable(ui).picked,
            edit: { editing = $0 },
            remove: { skus in
                draft.lines.removeAll { skus.contains($0.sku) }
                ui.picked.subtract(skus)
            })
            .popover(item: $editing, arrowEdge: .trailing) { line in
                SaleLineEditor(line: line, rates: f.rateBook.pricing) { changed in replace(line.sku, with: changed) }
                    .frame(width: 480, height: 620)
            }
            .popover(item: $newItem, arrowEdge: .trailing) { line in
                SaleLineEditor(line: line, rates: f.rateBook.pricing, create: true) { made in addNew(made) }
                    .frame(width: 480, height: 620)
            }
    }

    // MARK: The footer

    /// What Save will do, and Save: the document's footer. ⌘S saves (the Sale menu's key); Return saves only from the
    /// stock's box while it is empty.
    private func macFooter(_ f: SaleFigures, _ actions: SaleMacActions) -> some View {
        VStack(spacing: 0) {
            UpdateBanner()
            Divider()
            HStack(alignment: .center, spacing: 12) {
                macFooterStatus(f)
                Spacer(minLength: 12)
                Button { actions.save.perform() } label: {
                    HStack(spacing: 8) {
                        if saving { ProgressView().controlSize(.small) }
                        Text(macSaveTitle(f))
                    }
                    .frame(minWidth: 140)
                }
                .buttonStyle(.houseProminent)
                .disabled(!actions.save.enabled)
                .help(actions.save.help)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }

    @ViewBuilder
    private func macFooterStatus(_ f: SaleFigures) -> some View {
        if alreadySold {
            VStack(alignment: .leading, spacing: 2) {
                Text("This sale was already saved. Look for it in Invoices before saving it again.")
                    .font(.callout.weight(.semibold))
                NavigationLink(value: Route(path: "/invoices")) { Text("Open Invoices") }
            }
        } else if !goneSkus.isEmpty {
            Button("Take Them Off the Sale") {
                draft.lines.removeAll { goneSkus.contains($0.sku) }
                goneSkus = []
                alreadySold = false
            }
        } else if let reason = f.blockedReason {
            Text(reason)
                .font(.callout)
                .foregroundStyle(f.hasPieces ? Tone.problem.color : Tone.quiet.color)
                .lineLimit(2)
        } else if f.hasEstimate {
            let line = balanceLine(f.balance)
            Text(line.state == .paid ? "Paid in full" : "\(line.label) \(Money.pkr(line.amount))")
                .font(.callout)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }

    private func macSaveTitle(_ f: SaleFigures) -> String {
        let base = edit != nil ? "Save Changes" : "Save Sale"
        return f.hasEstimate ? "\(base) · \(Money.pkr(f.total))" : base
    }

    // MARK: The actions, declared once

    /// Every action of the window. The Sale menu, the toolbar and the right-click menus draw from these; a key lives only
    /// here. While a piece's editor is open nothing else in the sale is done (Save waits for it).
    func macActions(_ f: SaleFigures, _ ui: SaleMacUI) -> SaleMacActions {
        let idle = editing == nil && newItem == nil
        let picked = ui.picked
        let saveAction = MacAction(edit != nil ? "Save Changes" : "Save Sale", symbol: "checkmark.circle",
                                   shortcut: KeyboardShortcut("s", modifiers: .command),
                                   enabled: f.canSave && !saving && !UpdateGate.blocked && idle, isDefault: true) {
            Task { await save(f) }
        }
        let addPieceAction = MacAction("Add Piece", symbol: "plus", shortcut: KeyboardShortcut("l", modifiers: .command), enabled: idle) {
            ui.focusScanner()
        }
        let newItemAction = MacAction("New Item…", symbol: "plus.circle", enabled: idle) { startNewItem() }
        let scanAction = MacAction("Scan a Tag…", symbol: "qrcode.viewfinder", enabled: idle) { scanning = true }
        let readBillAction = MacAction("Read a Written Bill…", symbol: "camera.viewfinder", enabled: idle && session.isOwner) {
            readingBill = true
        }
        let editAction = MacAction("Edit Piece…", symbol: "pencil", enabled: picked.count == 1 && idle) {
            if let sku = picked.first, let line = draft.lines.first(where: { $0.sku == sku }) { editing = line }
        }
        let removeAction = MacAction(picked.count > 1 ? "Remove \(picked.count) Pieces" : "Remove Piece", symbol: "minus.circle",
                                     role: .destructive, enabled: !picked.isEmpty && idle) {
            draft.lines.removeAll { picked.contains($0.sku) }
            ui.picked = []
        }
        let orderAction = MacAction("Create Order from These Pieces", symbol: "list.clipboard",
                                    enabled: edit == nil && !draft.lines.isEmpty && idle) {
            // An order half typed is kept in Drafts, so nothing is thrown away; with drafts off it is asked about.
            if NewOrderDraftStore.orderInProgress && !draftsKept { confirmingOrder = true } else { createOrder() }
        }
        let resetAction = MacAction("Start Over…", symbol: "arrow.counterclockwise", role: .destructive,
                                    enabled: edit == nil && !draft.isBlank) {
            confirmingReset = true
        }
        return SaleMacActions(save: saveAction, addPiece: addPieceAction, newItem: newItemAction, scanTag: scanAction,
                              readBill: readBillAction, editPiece: editAction, removePieces: removeAction,
                              createOrder: orderAction, startOver: resetAction)
    }

    /// The Sale menu in the menu bar: the same actions, grouped.
    private func macMenu(_ a: SaleMacActions) -> MacRecordMenu {
        var groups: [[MacAction]] = [
            [a.save],
            [a.addPiece, a.newItem, a.scanTag, a.readBill],
            [a.editPiece, a.removePieces],
        ]
        if edit == nil {
            groups.append([a.createOrder])
            groups.append([a.startOver])
        }
        return MacRecordMenu(title: "Sale", groups: groups)
    }

    // MARK: The window's chrome and everything it presents

    /// The toolbar, the menu, and what the window presents: the same alerts, sheets, draft keeping and pages as the phone's.
    private func macWired<V: View>(_ content: V, _ f: SaleFigures, _ a: SaleMacActions, _ ui: SaleMacUI) -> some View {
        content
            .navigationSubtitle(f.hasEstimate ? "Total \(Money.pkr(f.total))" : "")
            .macRecordMenu(macMenu(a))
            .failureAlert($failure, title: "About this sale")
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button { ui.toggleStock() } label: { Label("Stock", systemImage: "sidebar.left") }
                        .help("Show or hide the stock")
                }
                ToolbarItemGroup(placement: .primaryAction) {
                    MacToolbarAction(action: a.readBill)
                    if edit == nil {
                        MacToolbarAction(action: a.createOrder)
                        MacToolbarAction(action: a.startOver)
                    }
                }
            }
            .sheet(isPresented: $scanning) {
                SaleScanSheet { code in scanned(code) }
                    .presentationSizing(.page)
            }
            .sheet(isPresented: $rateSheet) { RateSheet() }
            .confirmDestructive(isPresented: $confirmingReset, title: "Start over?",
                                message: "This empties the sale on this Mac and takes it out of Drafts: the pieces, the customer and everything typed.",
                                action: "Start Over") { startOver() }
            .confirmDestructive(isPresented: $confirmingOrder, title: "Replace the order in progress?",
                                message: "An order is half typed on this Mac. Making one from these pieces replaces it.",
                                action: "Replace It") { createOrder() }
            // The unfinished sale is kept at every change, as on the phone (appeared / changed / keepNow / sync).
            .onAppear { appeared() }
            .onChange(of: draft) { _, new in changed(new) }
            .onChange(of: scenePhase) { _, phase in
                if phase != .active { keepNow() }
            }
            .onDisappear { keepNow() }
            .onChange(of: query) { _, _ in notice = nil }
            .navigationDestination(item: $openOrder) { r in
                ScreenRegistry.view(for: r.path)
            }
            .navigationDestination(isPresented: $readingBill) {
                SaleScanScreen(draft: $draft, keep: edit == nil)
            }
    }
}
#endif
