#if os(macOS)
import SwiftUI
import ERPCore

// The Invoices place (docs/features/mac-design.md, "Invoices"): a sortable, multi-select table of the books' invoices, a
// saved list from the sidebar (Unpaid, Today, This Month) narrowing it, the search and a Taken by / Source pop-up in the
// toolbar, a one-line summary at its foot, and the picked invoice in the inspector. The Invoice menu (menu bar, toolbar,
// right-click) acts on the invoice picked; Return or a double-click opens it whole in a window of its own. Everything an
// action does is the invoice page's own sheet or send (MacInvoiceDesk), so a payment is taken one way wherever it is taken.

/// A table row: what is worked out from an invoice once, when the books, the search or the sort change, never per drawing.
struct MacInvoicesPlaceRow: Identifiable {
    let id: String
    let customer: String
    let createdAt: String
    let dateText: String
    let pieces: Int
    let total: Double
    let paid: Double
    /// What is owed, 0 for a settled, credited or refunded invoice.
    let due: Double
    let statusText: String
    let statusRank: Int
    let tone: Tone
    let takenBy: String
    let source: String
}

/// What the table shows and what its foot adds up.
struct MacInvoicesPlaceTable {
    var rows: [MacInvoicesPlaceRow] = []
    var byId: [String: MacInvoicesPlaceRow] = [:]
    var billed = 0.0
    var owed = 0.0
}

struct MacInvoicesPlace: View {
    /// The place's path from the sidebar: "/invoices", or "/invoices?list=unpaid" for a saved list.
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openPlaceWindow) private var openPlace

    @State private var selection = Set<String>()
    @State private var query = ""
    /// "" is anyone.
    @State private var takenBy = ""
    /// "" is every source.
    @State private var source = ""
    @State private var sort = [KeyPathComparator(\MacInvoicesPlaceRow.createdAt, order: .reverse)]
    @State private var made = Memo<MacInvoicesPlaceTable>()
    @State private var people = Memo<[String]>()
    @State private var channels = Memo<[String]>()
    @State private var desk = MacInvoiceDesk()

    var body: some View {
        let list = MacLists.list(in: path)
        let shown = made(rowsKey(list)) { build(list) }
        let picked = pickedInvoice()
        let cx = context()
        table(shown, cx)
            .macSummaryBar(summary(shown))
            .macSearchable(text: $query, prompt: "Search Invoices")
            .macInspector { MacInvoiceInspector(invoice: picked, count: selection.count, cx: cx) }
            .macRecordMenu(MacRecordMenu(title: "Invoice", groups: MacInvoiceMenu.groups(picked, cx)))
            .toolbar { toolbarItems(picked, cx) }
            .modifier(MacInvoiceSheetHost(desk: desk))
            .navigationTitle(title(list))
            .navigationSubtitle(subtitle(shown))
            .task {
                book.invoices.need()
                book.customers.need()
            }
    }

    // MARK: The table

    private func table(_ shown: MacInvoicesPlaceTable, _ cx: MacInvoiceContext) -> some View {
        Table(shown.rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Number", value: \.id) { r in Text(r.id).monospacedDigit() }
                .width(min: 90, ideal: 110)
            TableColumn("Customer", value: \.customer)
            TableColumn("Date", value: \.createdAt) { r in Text(r.dateText) }
                .width(min: 80, ideal: 100)
            TableColumn("Pieces", value: \.pieces) { r in Text("\(r.pieces)").monospacedDigit() }
                .width(50)
            TableColumn("Total", value: \.total) { r in
                Text(Money.pkr(r.total)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Paid", value: \.paid) { r in
                Text(Money.pkr(r.paid)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Owed", value: \.due) { r in
                // Only what needs someone is coloured; a settled bill shows nothing here.
                Text(r.due >= 1 ? Money.pkr(r.due) : "")
                    .monospacedDigit()
                    .foregroundStyle(r.tone.color)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Status", value: \.statusRank) { r in MacStatus(r.statusText, tone: r.tone) }
                .width(min: 80, ideal: 100)
            TableColumn("Taken By", value: \.takenBy)
                .width(min: 70, ideal: 90)
            TableColumn("Source", value: \.source)
                .width(min: 70, ideal: 90)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            rowMenu(ids, cx)
        } primaryAction: { ids in
            open(ids, cx)
        }
        .onKeyPress(.space) {
            // Space looks at the PDF, as it looks at a file in Finder.
            guard selection.count == 1, let id = selection.first, let inv = book.invoices.item(id) else { return .ignored }
            desk.pdf = InvoiceFacts.pdfTarget(inv, byCustomer: cx.byCustomer)
            return .handled
        }
        .overlay { emptyState(shown) }
    }

    /// The right-click menu: open it, then the Invoice menu's own actions for the invoice clicked.
    @ViewBuilder
    private func rowMenu(_ ids: Set<String>, _ cx: MacInvoiceContext) -> some View {
        if ids.count == 1, let id = ids.first, let inv = book.invoices.item(id) {
            Button("Open in New Window") { cx.open(Route(path: InvoiceFacts.path(id))) }
            Divider()
            MacActionItems(groups: MacInvoiceMenu.groups(inv, cx))
            Divider()
            Button("Copy Number") { UIPasteboard.general.string = id }
        } else if ids.count > 1 {
            Button("Open in New Windows") { open(ids, cx) }
            Button("Copy Numbers") { UIPasteboard.general.string = ids.sorted().joined(separator: "\n") }
        }
    }

    /// Return and a double-click: each picked invoice in a window of its own (five at most, as a mis-click must not open fifty).
    private func open(_ ids: Set<String>, _ cx: MacInvoiceContext) {
        for id in ids.sorted().prefix(5) { cx.open(Route(path: InvoiceFacts.path(id))) }
    }

    @ViewBuilder
    private func emptyState(_ shown: MacInvoicesPlaceTable) -> some View {
        if !book.invoices.loaded {
            ProgressView()
        } else if shown.rows.isEmpty {
            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                ContentUnavailableView("No Invoices", systemImage: "doc.text",
                                       description: Text("A sale you make will be here, with what is still owed on it."))
            }
        }
    }

    // MARK: The toolbar

    @ToolbarContentBuilder
    private func toolbarItems(_ picked: Invoice?, _ cx: MacInvoiceContext) -> some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { cx.open(Route(path: "/invoices/new")) } label: { Label("New Sale", systemImage: "plus") }
                .help("Make a new sale (⌘N)")
        }
        ToolbarItemGroup(placement: .primaryAction) {
            ForEach(MacInvoiceMenu.toolbar(picked, cx)) { MacToolbarAction(action: $0) }
        }
        ToolbarItem(placement: .primaryAction) {
            filterMenu()
        }
    }

    private var filtering: Bool { !takenBy.isEmpty || !source.isEmpty }

    /// Taken by and Source: the toolbar's pop-up (the saved lists are the sidebar's).
    private func filterMenu() -> some View {
        let who = people([book.invoices.revision]) {
            Array(Set(book.invoices.items.compactMap { $0.takenBy }.filter { !$0.isEmpty })).sorted()
        }
        let channelNames = channels([book.invoices.revision]) {
            Array(Set(book.invoices.items.compactMap { MacInvoiceWords.source($0) })).sorted()
        }
        return Menu {
            Picker("Taken By", selection: $takenBy) {
                Text("Anyone").tag("")
                ForEach(who, id: \.self) { p in Text(p).tag(p) }
            }
            Picker("Source", selection: $source) {
                Text("Every Source").tag("")
                ForEach(channelNames, id: \.self) { s in Text(s).tag(s) }
            }
            if filtering {
                Divider()
                Button("Clear Filters") { takenBy = ""; source = "" }
            }
            // The page's Import Shopify CSV: an owner's, as its own Firestore write is.
            if session.isOwner {
                Divider()
                Button("Import Shopify Orders…") { desk.importing = true }
            }
        } label: {
            Label("Filter", systemImage: filtering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .help("Show one person's sales, or one source")
    }

    // MARK: What is picked

    /// The one picked, for the inspector and the Invoice menu; nil with nothing picked or several.
    private func pickedInvoice() -> Invoice? {
        guard selection.count == 1, let id = selection.first else { return nil }
        return book.invoices.item(id)
    }

    private func context() -> MacInvoiceContext {
        let opener = openPlace
        let held = desk
        return MacInvoiceContext(isOwner: session.isOwner, canPay: InvoiceFacts.mayTakePayments(role: session.role),
                                 byCustomer: session.shop.invoiceByCustomer, desk: held) { route in
            if let opener { opener(route) } else { held.web = route }
        }
    }

    // MARK: Titles and the foot

    private func title(_ list: String?) -> String {
        guard let list, let found = MacLists.lists(for: "/invoices").first(where: { $0.id == list }) else { return "Invoices" }
        return found.title
    }

    private func subtitle(_ shown: MacInvoicesPlaceTable) -> String {
        let n = shown.rows.count
        return "\(n) invoice\(n == 1 ? "" : "s")"
    }

    /// "214 invoices · PKR 32.4 lac billed · PKR 1.2 lac owed"; with rows picked, the picked rows' own.
    private func summary(_ shown: MacInvoicesPlaceTable) -> [String] {
        let picked = selection.compactMap { shown.byId[$0] }
        if picked.isEmpty {
            let n = shown.rows.count
            return ["\(n) invoice\(n == 1 ? "" : "s")", billedWords(shown.billed), owedWords(shown.owed)]
        }
        let billedSum = picked.reduce(0) { $0 + $1.total }
        let owedSum = picked.reduce(0) { $0 + $1.due }
        return ["\(picked.count) of \(shown.rows.count) selected", billedWords(billedSum), owedWords(owedSum)]
    }

    private func billedWords(_ n: Double) -> String { Money.pkrLac(n, digits: 1) + " billed" }

    private func owedWords(_ n: Double) -> String { Money.pkrLac(n, digits: 1) + " owed" }

    // MARK: Making the rows

    /// What the rows depend on: the books, the search, the sort, the list and the filters, and the hour (the words "Today"
    /// and "Yesterday", and how old an owed bill is, move with the clock).
    private func rowsKey(_ list: String?) -> [Int] {
        [book.invoices.revision, book.customers.revision, query.hashValue, sort.hashValue, (list ?? "").hashValue,
         takenBy.hashValue, source.hashValue, Int(Date().timeIntervalSince1970 / 3_600)]
    }

    private func build(_ list: String?) -> MacInvoicesPlaceTable {
        let words = query.lowercased().split(whereSeparator: { $0 == " " }).map(String.init)
        var rows: [MacInvoicesPlaceRow] = []
        var billed = 0.0
        var owed = 0.0
        for inv in MacLists.invoices(book.invoices.items, list: list) {
            if !takenBy.isEmpty && (inv.takenBy ?? "") != takenBy { continue }
            let channel = MacInvoiceWords.source(inv) ?? ""
            if !source.isEmpty && channel != source { continue }
            if !words.isEmpty && !matches(inv, words) { continue }
            let status = MacInvoiceWords.status(inv)
            let due = isOwing(inv) ? inv.balanceDue : 0
            billed += inv.grandTotal
            owed += due
            rows.append(MacInvoicesPlaceRow(
                id: inv.id, customer: InvoiceFacts.customerName(inv), createdAt: inv.createdAt,
                dateText: ShopDate.say(inv.createdAt), pieces: inv.items.count, total: inv.grandTotal, paid: inv.amountPaid,
                due: due, statusText: status.text, statusRank: status.rank, tone: status.tone,
                takenBy: inv.takenBy ?? "", source: channel))
        }
        rows.sort(using: sort)
        var out = MacInvoicesPlaceTable()
        out.rows = rows
        out.byId = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        out.billed = billed
        out.owed = owed
        return out
    }

    /// Every word somewhere in the invoice: its number, the customer's name and number, a piece's name or stock number,
    /// who took it (the iPhone's search, word by word).
    private func matches(_ inv: Invoice, _ words: [String]) -> Bool {
        var text = [inv.id, inv.customerName, inv.customerContact ?? "", inv.takenBy ?? "", inv.shopifyOrderName ?? ""]
        var digits = ""
        let own = inv.customerContact ?? ""
        let theirs = inv.customerId.flatMap { book.customers.item($0)?.phone } ?? ""
        for phone in [own, theirs] where !phone.isEmpty {
            text.append(phone)
            digits += " " + CustomerSearch.digitsTyped(phone)
        }
        for item in inv.items {
            text.append(item.name)
            text.append(item.sku)
        }
        let hay = text.joined(separator: " ").lowercased()
        return words.allSatisfy { word in
            if hay.contains(word) { return true }
            let typed = CustomerSearch.digitsTyped(word)
            return typed.count >= 3 && word.allSatisfy { $0.isNumber || $0 == "+" } && digits.contains(typed)
        }
    }
}
#endif
