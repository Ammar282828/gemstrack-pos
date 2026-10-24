#if os(macOS)
import SwiftUI
import ERPCore

/// The five hubs a Mac shows as tables (Orders, Invoices, Customers, Stock, Repairs), by their sidebar path.
enum MacHubKind: String, CaseIterable {
    case orders = "/orders", invoices = "/invoices", customers = "/customers", stock = "/products", repairs = "/repairs"

    init?(path: String) { self.init(rawValue: ScreenRoute.bare(path)) }

    var title: String {
        switch self {
        case .orders: return "Orders"
        case .invoices: return "Invoices"
        case .customers: return "Customers"
        case .stock: return "Stock"
        case .repairs: return "Repairs"
        }
    }

    /// A row's own page: the same address the iPhone's row opens.
    func path(for id: String) -> String {
        let e = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#"))) ?? id
        switch self {
        case .repairs: return "/repairs?id=" + e
        default: return rawValue + "/" + e
        }
    }
}

/// A hub on the Mac: a sortable, searchable table of the books with the picked row's own page beside it (the same native
/// page the iPhone opens). Double-click or ⌘O opens a row in a window of its own; Stock prints the selected pieces' tags
/// through Label LIVE as one job. The hub's own page (its filters, figures and boards) is one click away as "Overview",
/// so nothing the iPhone's hub offers is lost.
struct MacHub: View {
    let kind: MacHubKind
    let rootPath: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var selection = Set<String>()
    @State private var query = ""
    @State private var overview = false
    @State private var detail: [Route] = []
    @State private var printing = false

    var body: some View {
        Group {
            if overview {
                PlaceScreen(path: rootPath, isRoot: true)
            } else {
                HSplitView {
                    table
                        .frame(minWidth: 420, idealWidth: 620)
                    NavigationStack(path: $detail) {
                        Group {
                            if selection.count == 1, let id = selection.first {
                                PlaceScreen(path: kind.path(for: id)).id(id)
                            } else if selection.count > 1 {
                                ContentUnavailableView("\(selection.count) selected", systemImage: "checklist",
                                                       description: Text(kind == .stock ? "Print their tags with ⌘P, or pick one to open it." : "Pick one to open it."))
                            } else if let prompt = HubSplitKind.prompt(for: rootPath) {
                                ContentUnavailableView(prompt.title, systemImage: prompt.symbol)
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .navigationDestination(for: Route.self) { PlaceScreen(path: $0.path) }
                    }
                    .frame(minWidth: 460)
                }
            }
        }
        .navigationTitle(kind.title)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("View", selection: $overview) {
                    Text("Table").tag(false)
                    Text("Overview").tag(true)
                }
                .pickerStyle(.segmented)
                .help("The table of every record, or the hub's own page with its figures and filters")
            }
            if kind == .stock, !overview {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        printTags()
                    } label: {
                        Label(selection.count > 1 ? "Print \(selection.count) tags" : "Print tag", systemImage: "printer")
                    }
                    .disabled(selection.isEmpty || printing)
                    .help("Print the selected pieces' tags as one job: choose copies and blank labels, then Print (⌥⌘P prints at once)")
                }
            }
        }
        .searchable(text: $query, placement: .toolbar, prompt: "Search \(kind.title.lowercased())")
        .onChange(of: selection) { _, _ in detail = [] }
        .focusedSceneValue(\.macStockSelection, kind == .stock ? MacStockSelection(skus: Array(selection)) : nil)
    }

    private func printTags() {
        let skus = Array(selection)
        printing = true
        Task {
            await MacPrint.printTags(skus)
            printing = false
        }
    }

    @ViewBuilder
    private var table: some View {
        switch kind {
        case .orders: MacOrdersTable(query: query, selection: $selection)
        case .invoices: MacInvoicesTable(query: query, selection: $selection)
        case .customers: MacCustomersTable(query: query, selection: $selection)
        case .stock: MacStockTable(query: query, selection: $selection)
        case .repairs: MacRepairsTable(query: query, selection: $selection)
        }
    }
}

/// What ⌘P prints when Stock's table has pieces selected.
struct MacStockSelection: Equatable { let skus: [String] }

private struct MacStockSelectionKey: FocusedValueKey { typealias Value = MacStockSelection }

extension FocusedValues {
    var macStockSelection: MacStockSelection? {
        get { self[MacStockSelectionKey.self] }
        set { self[MacStockSelectionKey.self] = newValue }
    }
}

// MARK: - The tables

/// Whether a row matches the search: every word somewhere in its text.
private func matches(_ query: String, _ fields: [String?]) -> Bool {
    let words = query.lowercased().split(separator: " ").map(String.init)
    guard !words.isEmpty else { return true }
    let text = fields.compactMap { $0?.lowercased() }.joined(separator: " ")
    return words.allSatisfy { text.contains($0) }
}

/// A row's context menu and double-click: open it in a window of its own.
private struct RowActions: ViewModifier {
    let kind: MacHubKind
    @Environment(\.openPlaceWindow) private var openPlace

    func body(content: Content) -> some View {
        content.contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first {
                Button("Open in New Window") { openPlace?(Route(path: kind.path(for: id))) }
                Button("Copy \(kind == .stock ? "SKU" : "Number")") { UIPasteboard.general.string = ids.sorted().joined(separator: "\n") }
            }
        } primaryAction: { ids in
            for id in ids.prefix(5) { openPlace?(Route(path: kind.path(for: id))) }
        }
    }
}

struct MacOrdersTable: View {
    let query: String
    @Binding var selection: Set<String>
    @Environment(Book.self) private var book
    @State private var sort = [KeyPathComparator(\MacOrderRow.createdAt, order: .reverse)]

    var body: some View {
        let rows = book.orders.items
            .filter { matches(query, [$0.id, $0.customerName, $0.customerContact, $0.summary, $0.status.rawValue, $0.takenBy]) }
            .map(MacOrderRow.init)
            .sorted(using: sort)
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Order", value: \.id) { Text($0.id).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Customer", value: \.customer)
            TableColumn("Taken", value: \.createdAt) { Text(ShopDate.say($0.createdAt)) }.width(min: 80, ideal: 100)
            TableColumn("Promised", value: \.promised) { Text($0.promised.isEmpty ? "" : ShopDate.say($0.promised)) }.width(min: 80, ideal: 100)
            TableColumn("Status", value: \.status) { r in Pill(r.status, tone: Tone(status: r.order.status)) }.width(min: 90, ideal: 120)
            TableColumn("Pieces", value: \.pieces) { Text("\($0.pieces)") }.width(50)
            TableColumn("Total", value: \.total) { Text(Money.pkr($0.total)).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Advance", value: \.advance) { Text($0.advance > 0 ? Money.pkr($0.advance) : "").monospacedDigit() }.width(min: 90, ideal: 110)
        }
        .modifier(RowActions(kind: .orders))
        .onAppear { book.orders.need() }
        .overlay { if !book.orders.loaded { ProgressView() } }
    }
}

struct MacOrderRow: Identifiable {
    let order: Order
    var id: String { order.id }
    var customer: String { order.customerName ?? "" }
    var createdAt: String { order.createdAt }
    var promised: String { order.promisedDate ?? "" }
    var status: String { order.status.rawValue }
    var pieces: Int { order.items.count }
    var total: Double { order.grandTotal }
    var advance: Double { order.advancePayment }
    init(_ o: Order) { order = o }
}

struct MacInvoicesTable: View {
    let query: String
    @Binding var selection: Set<String>
    @Environment(Book.self) private var book
    @State private var sort = [KeyPathComparator(\MacInvoiceRow.createdAt, order: .reverse)]

    var body: some View {
        let rows = book.invoices.items
            .filter { matches(query, [$0.id, $0.customerName, $0.customerContact, $0.takenBy, $0.shopifyOrderName]) }
            .map(MacInvoiceRow.init)
            .sorted(using: sort)
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Invoice", value: \.id) { Text($0.id).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Customer", value: \.customer)
            TableColumn("Date", value: \.createdAt) { Text(ShopDate.say($0.createdAt)) }.width(min: 80, ideal: 100)
            TableColumn("Pieces", value: \.pieces) { Text("\($0.pieces)") }.width(50)
            TableColumn("Total", value: \.total) { Text(Money.pkr($0.total)).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Paid", value: \.paid) { Text(Money.pkr($0.paid)).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Owed", value: \.due) { r in
                // Rule 15: only what needs someone is coloured; a settled bill shows nothing here.
                Text(r.due >= 1 ? Money.pkr(r.due) : "").monospacedDigit().foregroundStyle(Tone.owed.color)
            }
            .width(min: 90, ideal: 110)
        }
        .modifier(RowActions(kind: .invoices))
        .onAppear { book.invoices.need() }
        .overlay { if !book.invoices.loaded { ProgressView() } }
    }
}

struct MacInvoiceRow: Identifiable {
    let invoice: Invoice
    var id: String { invoice.id }
    var customer: String { invoice.customerName }
    var createdAt: String { invoice.createdAt }
    var pieces: Int { invoice.items.count }
    var total: Double { invoice.grandTotal }
    var paid: Double { invoice.amountPaid }
    var due: Double { invoice.balanceDue }
    init(_ i: Invoice) { invoice = i }
}

struct MacCustomersTable: View {
    let query: String
    @Binding var selection: Set<String>
    @Environment(Book.self) private var book
    @State private var sort = [KeyPathComparator(\MacCustomerRow.name)]

    var body: some View {
        let rows = book.customers.items
            .filter { $0.deletedAt == nil && matches(query, [$0.name, $0.phone, $0.altPhone, $0.email, $0.city, $0.tags.joined(separator: " ")]) }
            .map(MacCustomerRow.init)
            .sorted(using: sort)
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Name", value: \.name)
            TableColumn("Phone", value: \.phone) { Text($0.phone).monospacedDigit() }.width(min: 110, ideal: 130)
            TableColumn("City", value: \.city).width(min: 80, ideal: 110)
            TableColumn("Came from", value: \.source).width(min: 80, ideal: 110)
            TableColumn("Ring", value: \.ring).width(50)
            TableColumn("Tags", value: \.tags)
        }
        .modifier(RowActions(kind: .customers))
        .onAppear { book.customers.need() }
        .overlay { if !book.customers.loaded { ProgressView() } }
    }
}

struct MacCustomerRow: Identifiable {
    let customer: Customer
    var id: String { customer.id }
    var name: String { customer.name }
    var phone: String { customer.phone ?? "" }
    var city: String { customer.city ?? "" }
    var source: String { customer.source.map { "\($0)" } ?? "" }
    var ring: String { customer.ringSize ?? "" }
    var tags: String { customer.tags.joined(separator: ", ") }
    init(_ c: Customer) { customer = c }
}

struct MacStockTable: View {
    let query: String
    @Binding var selection: Set<String>
    @Environment(Book.self) private var book
    @State private var sort = [KeyPathComparator(\MacStockRow.sku)]

    var body: some View {
        let rates = book.settings.value.map(PricingRates.init)
        let rows = book.products.items
            .filter { matches(query, [$0.sku, $0.name, categoryTitle($0.categoryId) ?? $0.categoryId, $0.description, $0.stoneDetails]) }
            .map { MacStockRow($0, rates: rates) }
            .sorted(using: sort)
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("SKU", value: \.sku) { Text($0.sku).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Name", value: \.name)
            TableColumn("Category", value: \.category).width(min: 80, ideal: 120)
            TableColumn("Metal", value: \.metal).width(min: 70, ideal: 90)
            TableColumn("Weight", value: \.weight) { Text(String(format: "%.3f g", $0.weight)).monospacedDigit() }.width(min: 70, ideal: 90)
            TableColumn("Price today", value: \.price) { Text($0.price > 0 ? Money.pkr($0.price) : "").monospacedDigit() }.width(min: 90, ideal: 120)
        }
        .modifier(RowActions(kind: .stock))
        .onAppear { book.products.need(); book.settings.need() }
        .overlay { if !book.products.loaded { ProgressView() } }
    }
}

struct MacStockRow: Identifiable {
    let product: Product
    let price: Double
    var id: String { product.sku }
    var sku: String { product.sku }
    var name: String { product.name }
    var category: String { categoryTitle(product.categoryId) ?? product.categoryId }
    var metal: String { [product.metalType.rawValue, product.karat?.rawValue ?? ""].filter { !$0.isEmpty }.joined(separator: " ") }
    var weight: Double { product.metalWeightG }

    /// The price the stock list shows: the piece's own when it has one, else worked out at today's rates (ERPCore pricing).
    init(_ p: Product, rates: PricingRates?) {
        product = p
        if p.isCustomPrice, let custom = p.customPrice, custom > 0 { price = custom }
        else if let rates { price = calculateProductCosts(PricedPiece(p), rates).totalPrice }
        else { price = 0 }
    }
}

struct MacRepairsTable: View {
    let query: String
    @Binding var selection: Set<String>
    @Environment(Book.self) private var book
    @State private var sort = [KeyPathComparator(\MacRepairRow.receivedAt, order: .reverse)]

    var body: some View {
        let rows = book.repairs.items
            .filter { matches(query, [$0.id, $0.customerName, $0.customerContact, $0.karigarName, $0.pieces.map(\.item).joined(separator: " ")]) }
            .map(MacRepairRow.init)
            .sorted(using: sort)
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Repair", value: \.id) { Text($0.id).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Customer", value: \.customer)
            TableColumn("In", value: \.receivedAt) { Text(ShopDate.say($0.receivedAt)) }.width(min: 80, ideal: 100)
            TableColumn("Promised", value: \.promised) { Text($0.promised.isEmpty ? "" : ShopDate.say($0.promised)) }.width(min: 80, ideal: 100)
            TableColumn("Status", value: \.status).width(min: 80, ideal: 100)
            TableColumn("Pieces", value: \.pieces) { Text($0.pieces) }
            TableColumn("Karigar", value: \.karigar).width(min: 80, ideal: 110)
        }
        .modifier(RowActions(kind: .repairs))
        .onAppear { book.repairs.need() }
        .overlay { if !book.repairs.loaded { ProgressView() } }
    }
}

struct MacRepairRow: Identifiable {
    let repair: Repair
    var id: String { repair.id }
    var customer: String { repair.customerName }
    var receivedAt: String { repair.receivedAt }
    var promised: String { repair.promisedDate ?? "" }
    var status: String {
        switch repair.status {
        case .received: return "In the shop"
        case .ready: return "Ready"
        case .collected: return "Collected"
        case .cancelled: return "Cancelled"
        case .unknown(let s): return s
        }
    }
    var pieces: String { repair.pieces.map(\.item).joined(separator: ", ") }
    var karigar: String { repair.karigarName ?? "" }
    init(_ r: Repair) { repair = r }
}
#endif
