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

    var body: some View {
        if session.isOwner {
            SaleForm()
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

    @State var draft = SaleDraft()
    @State var query = ""
    @State var notice: String?
    @State var editing: SaleLine?
    /// A piece being described that is not on the sale yet.
    @State var newItem: SaleLine?
    @State var pickingCustomer = false
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
    @State var ratesNote: String?
    /// The order form, opened from this sale's pieces.
    @State var openOrder: Route?
    @State var confirmingOrder = false

    var body: some View {
        Group {
            if let id = made {
                InvoiceScreen(id: id)
                    .overlay(alignment: .top) { ratesNoteBanner }
            } else if !book.settings.loaded {
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                page
            }
        }
        .task {
            book.settings.need()
            book.products.need()
            book.customers.need()
            book.invoices.need()
        }
    }

    /// A line over the invoice when a rate typed on the sale could not be kept as the shop's (the web's toast).
    @ViewBuilder
    private var ratesNoteBanner: some View {
        if let note = ratesNote {
            Text(note)
                .font(.footnote.weight(.medium))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
                .padding(.horizontal, 16).padding(.top, 6)
                .task {
                    try? await Task.sleep(for: .seconds(8))
                    ratesNote = nil
                }
        }
    }

    // MARK: The page

    private var page: some View {
        let f = SaleFigures(draft: draft, settings: book.settings.value, customers: book.customers.items, marginSettings: House.margin)
        return Form { Group {
            customerSection(f)
            piecesSection(f)
            ratesSection(f)
            discountSection(f)
            exchangeSection()
            paymentSection(f)
            shopSection(f)
            deliverySection(f)
            totalsSection(f)
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("New sale")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Start over", role: .destructive) { confirmingReset = true }
                    .disabled(draft.isBlank)
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { SaleKeyboard.dismiss() }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { saveBar(f) }
        .sheet(isPresented: $pickingCustomer) {
            SaleCustomerPicker { c in pickCustomer(c) }
        }
        .sheet(item: $editing) { line in
            SaleLineEditor(line: line, rates: f.rateBook.pricing) { changed in replace(line.sku, with: changed) }
        }
        .sheet(item: $newItem) { line in
            SaleLineEditor(line: line, rates: f.rateBook.pricing, create: true) { made in addNew(made) }
        }
        .sheet(isPresented: $scanning) {
            SaleScanSheet { code in scanned(code) }
        }
        .sheet(isPresented: $rateSheet) { RateSheet() }
        .confirmationDialog("Start over?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Start over", role: .destructive) { startOver() }
        } message: {
            Text("This empties the sale on this phone and takes it out of Drafts: the pieces, the customer and everything typed.")
        }
        .confirmationDialog("Replace the order in progress?", isPresented: $confirmingOrder, titleVisibility: .visible) {
            Button("Replace it", role: .destructive) { createOrder() }
        } message: {
            Text("An order is half typed on this phone. Making one from these pieces replaces it.")
        }
        // This phone's own unfinished sale, written as it is typed. The scan screen can add a piece
        // to it while this one waits underneath, so it is read again whenever the screen appears.
        .onAppear { appeared() }
        .onChange(of: draft) { _, d in
            SaleDraftStore.save(d)
            sync(d)
        }
        .onDisappear { if made == nil { sync(draft, now: true) } }
        .onChange(of: query) { _, _ in notice = nil }
        // "Create order": the order form opens on this sale's pieces (NewOrderDraftStore.startFromSale).
        .navigationDestination(item: $openOrder) { r in
            ScreenRegistry.view(for: r.path)
        }
    }

    /// The counter name Taken by starts on: this account's, when it has one on the house's list.
    var defaultTaker: String { session.shop.person ?? "" }

    /// Every time the screen shows: this phone's unfinished sale is read again (the scan screen can add a
    /// piece to it while this one waits underneath). A sale cleared elsewhere (an order made from its
    /// pieces) starts afresh. A brand-new sale starts Taken by on the signed-in person, once.
    func appeared() {
        if let stored = SaleDraftStore.load() {
            if stored != draft { draft = stored }
            if !stored.isBlank { Task { await stillOurs() } }
        } else if !draft.isBlank {
            draft = SaleDraft()
            draft.takenBy = defaultTaker
        } else if !takenByStarted {
            draft.takenBy = defaultTaker
        }
        takenByStarted = true
    }

    /// The sale in Drafts as the web's sale page holds it, a moment after the last change (`now` as the screen
    /// goes), so it can be finished at the counter (WorkDraftSync).
    func sync(_ d: SaleDraft, now: Bool = false) {
        let settings = book.settings.value
        let customers = book.customers.items
        WorkDraftSync.sale.push(blank: d.isBlank, enabled: settings?.autoDraftForms ?? true, now: now) {
            let subtotal = SaleFigures(draft: d, settings: settings, customers: customers, marginSettings: House.margin).subtotal
            return WorkDraftSync.Snapshot(values: d.webValues(subtotal: subtotal), total: subtotal, customerName: d.customerName)
        }
    }

    /// The sale kept on this phone is in Drafts too: one invoiced or thrown away at the counter since is not
    /// this phone's to bill a second time, so it goes from here as well.
    func stillOurs() async {
        guard await WorkDraftSync.sale.stillThere() == false, made == nil else { return }
        SaleDraftStore.clear()
        WorkDraftSync.sale.forget()
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
    func scanned(_ code: String) -> String {
        let sku = TagCode.sku(from: code)
        guard let p = SaleLookup.find(sku, in: book.products.items) else { return notInStock(sku) }
        if draft.lines.contains(where: { $0.sku == p.sku }) { return "\(p.name) is already on this sale." }
        draft.lines.append(SaleLine(p))
        return "Added \(p.name) (\(p.sku))."
    }

    func startOver() {
        SaleDraftStore.clear()
        WorkDraftSync.sale.drop()
        draft = SaleDraft()
        draft.takenBy = defaultTaker
        query = ""
        notice = nil
        failure = nil
        goneSkus = []
        alreadySold = false
        openedExchange = []
    }
}
