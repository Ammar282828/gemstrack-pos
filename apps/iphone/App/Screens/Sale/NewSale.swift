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
/// An unfinished sale is kept on this phone (UserDefaults "erp.saleDraft") and in the ERP's Drafts, in the
/// sale page's own shape, so the counter can finish it (WorkDraftSync, SaleWebDraft). "Start over" empties both.
struct NewSale: View {
    @Environment(Session.self) private var session
    /// Opened from the New chooser's Read a written bill: the reader comes up over the form, once.
    var readsBill = false

    var body: some View {
        if session.isOwner {
            SaleForm(startsReading: readsBill)
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
        // This phone's own unfinished sale, written as it is typed. The scan screen can add a piece
        // to it while this one waits underneath, so it is read again whenever the screen appears.
        .onAppear { appeared() }
        // Written a moment after the last key (as New order does), and at once as the app leaves or the screen goes.
        .task(id: draft) {
            // An edit is never kept on the phone or in Drafts: the invoice on file is the copy.
            guard edit == nil, takenByStarted else { return }
            do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
            SaleDraftStore.save(draft, business: biz.id)
            sync(draft)
        }
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

    /// The unfinished sale, written now rather than after the pause (the app leaving, the screen going).
    func keepNow() {
        guard made == nil, edit == nil, takenByStarted else { return }
        SaleDraftStore.save(draft, business: biz.id)
        sync(draft, now: true)
    }

    /// The counter name Taken by starts on: this account's, when it has one on the house's list.
    var defaultTaker: String { session.shop.person ?? "" }

    /// Every time the screen shows: this phone's unfinished sale is read again (the scan screen can add a
    /// piece to it while this one waits underneath). A sale cleared elsewhere (an order made from its
    /// pieces) starts afresh. A brand-new sale starts Taken by on the signed-in person, once.
    func appeared() {
        if let edit {
            if !editLoaded {
                draft = edit.draft
                editLoaded = true
            }
            return
        }
        if let stored = SaleDraftStore.load(business: biz.id) {
            var kept = stored
            // A sale begun from Scan a tag has no Taken by yet: it starts on the signed-in person, as every new one.
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

    /// The sale in Drafts as the web's sale page holds it, a moment after the last change (`now` as the screen
    /// goes), so it can be finished at the counter (WorkDraftSync).
    func sync(_ d: SaleDraft, now: Bool = false) {
        let settings = book.settings.value
        let customers = book.customers.items
        WorkDraftSync.sale.push(blank: d.isBlank, enabled: settings?.autoDraftForms ?? true, now: now, business: biz) {
            let subtotal = SaleFigures(draft: d, settings: settings, customers: customers, marginSettings: House.margin).subtotal
            return WorkDraftSync.Snapshot(values: d.webValues(subtotal: subtotal), total: subtotal, customerName: d.customerName)
        }
    }

    /// The sale kept on this phone is in Drafts too: one invoiced or thrown away at the counter since is not
    /// this phone's to bill a second time, so it goes from here as well.
    func stillOurs() async {
        guard await WorkDraftSync.sale.stillThere(business: biz) == false, made == nil else { return }
        SaleDraftStore.clear(business: biz.id)
        WorkDraftSync.sale.forget(biz.id)
        startOver()
        failure = "The sale kept on this phone was invoiced or discarded from Drafts on another device, so it is cleared here. Look for it under Invoices."
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
/// New sale and Edit invoice on the Mac (SaleMacKit.swift): the stock at the left with the scanner's box, the bill at the
/// right with the rest of the sale's sections under it, Save in the footer (Return, or ⌘S). The steps of the phone are
/// sections here; every action is SaleForm's own.
extension SaleForm {
    @ViewBuilder
    var macPage: some View {
        let f = SaleFigures(draft: draft, settings: book.settings.value, customers: book.customers.items, marginSettings: House.margin)
        let split = SaleMacSplit(
            left: { scanner in
                SaleMacPicker(products: book.products.items, taken: Set(draft.lines.map { $0.sku }),
                              pricing: f.rateBook.pricing, query: $query, notice: notice, scannerFocused: scanner,
                              add: { add($0) }, submit: { addTyped() }, scan: { scanning = true },
                              newItem: { startNewItem() })
            },
            right: {
                VSplitView {
                    SaleMacBill(lines: draft.lines, figures: f, spec: { spec($0) },
                                isGone: { line in book.products.loaded && !line.isOneOff && book.products.item(line.sku) == nil },
                                edit: { editing = $0 },
                                remove: { skus in draft.lines.removeAll { skus.contains($0.sku) } })
                        .frame(minHeight: 230, idealHeight: 320)
                    macForm(f)
                        .frame(minHeight: 200)
                }
            },
            footer: { scanner in macFooter(f, scannerFocused: scanner) })
        return macWired(split, f)
    }

    /// The sale's other sections, one scrolling form under the bill: customer, rates, discount, exchange, payment,
    /// the shop's own, delivery.
    private func macForm(_ f: SaleFigures) -> some View {
        Form {
            Group {
                if let edit {
                    Section {
                        Label(edit.paidBefore > 0
                              ? "\(Money.pkr(edit.paidBefore)) paid before stays on \(edit.invoiceId). A payment added below is taken now. A piece taken off stays sold."
                              : "Nothing is paid on \(edit.invoiceId) yet. A payment added below is taken now. A piece taken off stays sold.",
                              systemImage: "pencil.and.list.clipboard")
                            .font(.subheadline)
                    }
                }
                customerSection(f)
                ratesSection(f)
                discountSection(f)
                exchangeSection()
                paymentSection(f)
                shopSection(f)
                deliverySection(f)
                orderSection()
            }
            .houseRows()
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
    }

    /// What Save will do, and Save: the dialog's footer. Return saves unless the scanner's box has the keyboard.
    private func macFooter(_ f: SaleFigures, scannerFocused: Bool) -> some View {
        VStack(spacing: 0) {
            UpdateBanner()
            Divider()
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    if alreadySold {
                        Text("This sale was already saved. Look for it in Invoices before saving it again.")
                            .font(.callout.weight(.semibold))
                        NavigationLink(value: Route(path: "/invoices")) { Text("Open Invoices") }
                    } else if !goneSkus.isEmpty {
                        Button("Take them off the sale") {
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
                            .font(.callout).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                Spacer(minLength: 12)
                macSaveButton(f, scannerFocused: scannerFocused)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
        }
        .background(.bar)
    }

    @ViewBuilder
    private func macSaveButton(_ f: SaleFigures, scannerFocused: Bool) -> some View {
        let button = Button { Task { await save(f) } } label: {
            HStack(spacing: 8) {
                if saving { ProgressView().controlSize(.small) }
                Text(edit != nil ? (f.hasEstimate ? "Save changes · \(Money.pkr(f.total))" : "Save changes")
                     : (f.hasEstimate ? "Save sale · \(Money.pkr(f.total))" : "Save sale"))
            }
            .frame(minWidth: 140)
        }
        .buttonStyle(.houseProminent)
        .controlSize(.large)
        .disabled(!f.canSave || saving || UpdateGate.blocked)
        // Return in the scanner's box adds a piece: it must never also save the sale.
        if scannerFocused {
            button
        } else {
            button.keyboardShortcut(.defaultAction)
        }
    }

    /// The window's toolbar and everything the page presents: the same sheets, draft keeping and pages as the phone's.
    private func macWired<V: View>(_ content: V, _ f: SaleFigures) -> some View {
        content
            .navigationSubtitle(f.hasEstimate ? "Total \(Money.pkr(f.total))" : "")
            .background {
                // ⌘S saves from anywhere (save(f) does nothing until the sale can be saved).
                Button("Save") { Task { await save(f) } }
                    .keyboardShortcut("s", modifiers: .command).opacity(0).accessibilityHidden(true)
            }
            .failureAlert($failure, title: "About this sale")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { startNewItem() } label: { Label("New item", systemImage: "plus.circle") }
                        .help("A piece that is not in stock, described for this bill only")
                    Button { readingBill = true } label: { Label("Read a written bill", systemImage: "camera.viewfinder") }
                        .help("Read a handwritten bill and put its lines on this sale")
                    Menu {
                        if edit == nil {
                            Button { if NewOrderDraftStore.orderInProgress { confirmingOrder = true } else { createOrder() } } label: {
                                Label("Create order from these pieces", systemImage: "list.clipboard")
                            }
                            .disabled(draft.lines.isEmpty)
                            Divider()
                            Button(role: .destructive) { confirmingReset = true } label: {
                                Label("Start over", systemImage: "arrow.counterclockwise")
                            }
                            .disabled(draft.isBlank)
                        }
                    } label: {
                        Label("More", systemImage: "ellipsis.circle")
                    }
                    .disabled(edit != nil)
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
                                message: "This empties the sale on this Mac and takes it out of Drafts: the pieces, the customer and everything typed.",
                                action: "Start over") { startOver() }
            .confirmDestructive(isPresented: $confirmingOrder, title: "Replace the order in progress?",
                                message: "An order is half typed on this Mac. Making one from these pieces replaces it.",
                                action: "Replace it") { createOrder() }
            // The unfinished sale is kept as it is typed, as on the phone (appeared / keepNow / sync).
            .onAppear { appeared() }
            .task(id: draft) {
                guard edit == nil, takenByStarted else { return }
                do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
                SaleDraftStore.save(draft, business: biz.id)
                sync(draft)
            }
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
