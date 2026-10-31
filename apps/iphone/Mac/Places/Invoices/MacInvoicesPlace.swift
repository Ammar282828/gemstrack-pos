#if os(macOS)
import SwiftUI
import ERPCore

// The Invoices place (docs/features/mac-design.md, "Invoices"): a sortable, multi-select table of the books' invoices, a
// saved list from the sidebar (Unpaid, Today, This Month) narrowing it, the search and one Filter menu (Taken by, Source) in
// the toolbar beside New Sale, a one-line summary at its foot, and the picked invoice in the inspector. The Invoice menu
// (menu bar, inspector, right-click) acts on the invoice picked, never the toolbar; Return or a double-click opens it whole
// in a window of its own. Everything an action does is the invoice page's own sheet or send (MacInvoiceDesk), so a payment
// is taken one way wherever it is taken. Seven columns fit a 13-inch MacBook beside the sidebar and the inspector (the
// pieces, who took it and where it came from are the inspector's).

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
    /// What was sold ("Drop earrings +2 more"), the time of day and the day's own heading, for the iPhone's row.
    let sold: String
    let timeText: String
    let heading: String
    /// A web order's WhatsApp, as the ERP's invoices list says it ("Confirmed on WhatsApp", "Cancel requested").
    let whatsapp: (label: String, tone: Tone)?
}

/// A web order's WhatsApp state in the house's tones (`WhatsAppOrder.chip`, the web's `whatsappOrderChip`).
enum MacWhatsAppChip {
    static func of(_ invoice: Invoice) -> (label: String, tone: Tone)? {
        guard let chip = invoice.whatsappOrder?.chip else { return nil }
        let tone: Tone
        switch chip.tone {
        case "late": tone = .late
        case "owed": tone = .owed
        case "settled": tone = .settled
        case "working": tone = .working
        default: tone = .quiet
        }
        return (chip.label, tone)
    }
}

/// How the list is ordered: by day as the iPhone's is (newest first, under each day's heading), or flat by a column's old sort.
enum MacInvoicesSort: String, CaseIterable, Identifiable {
    case date, total, owed, customer
    var id: String { rawValue }
    var title: String {
        switch self {
        case .date: return "Date"
        case .total: return "Total"
        case .owed: return "Amount Owed"
        case .customer: return "Customer"
        }
    }
}

/// One section of the list: a day's invoices with what they billed.
struct MacInvoicesPlaceGroup: Identifiable {
    let id: String
    let title: String
    let rows: [MacInvoicesPlaceRow]
    let billed: Double
}

/// What a search reads of an invoice, made once per change of the books (not once per keystroke): all its words in lower
/// case, and the digits of its phone numbers.
struct MacInvoicesPlaceHay {
    let text: String
    let digits: String
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
    @State private var sort = MacInvoicesSort.date
    @State private var made = Memo<MacInvoicesPlaceTable>()
    @State private var ordered = Memo<[MacInvoicesPlaceGroup]>()
    @State private var people = Memo<[String]>()
    @State private var channels = Memo<[String]>()
    @State private var hays = Memo<[String: MacInvoicesPlaceHay]>()
    @State private var desk = MacInvoiceDesk()

    var body: some View {
        let list = MacLists.list(in: path)
        let key = rowsKey(list)
        let shown = made(key) { build(list) }
        // The sort alone only puts the same rows in another order.
        let sorted = ordered(key + [sort.hashValue]) { groups(shown.rows) }
        let picked = pickedInvoice()
        let cx = context()
        ShelfState(loaded: book.invoices.loaded, error: book.invoices.error, offline: book.invoices.offline) {
            table(sorted, shown, list, cx)
                .macSummaryBar(summary(shown))
        }
        .macSearchable(text: $query, prompt: "Search Invoices")
        .macInspector { MacInvoiceInspector(invoice: picked, count: selection.count, cx: cx) }
        .macRecordMenu(MacRecordMenu(title: "Invoice", groups: MacInvoiceMenu.groups(picked, cx) + [[MacInvoiceMenu.importOrders(cx)]]))
        .toolbar { toolbarItems(cx) }
        .modifier(MacInvoiceSheetHost(desk: desk))
        .navigationTitle(title(list))
        .navigationSubtitle(subtitle(shown))
        .task {
            book.invoices.need()
            book.customers.need()
        }
    }

    // MARK: The table

    private func table(_ groups: [MacInvoicesPlaceGroup], _ shown: MacInvoicesPlaceTable, _ list: String?,
                        _ cx: MacInvoiceContext) -> some View {
        let person = session.shop.person ?? ""
        let named = list == nil ? "" : title(list)
        return List(selection: $selection) {
            ForEach(groups) { (g: MacInvoicesPlaceGroup) in
                Section {
                    ForEach(g.rows) { (r: MacInvoicesPlaceRow) in
                        MacInvoiceListRow(row: r, mine: !person.isEmpty && r.takenBy == person, dated: sort != .date)
                            .tag(r.id)
                            .macOpensOnDoubleClick { open([r.id], cx) }
                    }
                } header: {
                    // The days' headings, but not one the window's own title already says ("Today" over today's list).
                    if sort == .date && g.title.caseInsensitiveCompare(named) != .orderedSame {
                        LedgerHeading(title: g.title, count: g.rows.count, trailing: Money.pkrLac(g.billed, digits: 1))
                    }
                }
                .houseRows()
            }
        }
        .listStyle(.inset)
        .modifier(HouseGround())
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            rowMenu(ids, cx)
        } primaryAction: { (ids: Set<String>) in
            open(ids, cx)
        }
        .macOpensOnReturn(selection) { (ids: Set<String>) in open(ids, cx) }
        .onKeyPress(.space) {
            // Space looks at the PDF, as it looks at a file in Finder.
            guard selection.count == 1, let id = selection.first, let inv = book.invoices.item(id) else { return .ignored }
            desk.pdf = InvoiceFacts.pdfTarget(inv, byCustomer: cx.byCustomer)
            return .handled
        }
        .overlay { emptyState(shown, list) }
    }

    /// The right-click menu: open it, then the Invoice menu's own actions for the invoice clicked.
    @ViewBuilder
    private func rowMenu(_ ids: Set<String>, _ cx: MacInvoiceContext) -> some View {
        if ids.isEmpty {
            // The empty part of the table: what is not about one invoice.
            MacActionItems(groups: [[MacInvoiceMenu.importOrders(cx)]])
        } else if ids.count == 1, let id = ids.first, let inv = book.invoices.item(id) {
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
    private func emptyState(_ shown: MacInvoicesPlaceTable, _ list: String?) -> some View {
        if shown.rows.isEmpty {
            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView.search(text: query)
            } else if filtering {
                ContentUnavailableView("No Invoices Match", systemImage: "line.3.horizontal.decrease.circle",
                                       description: Text("Clear the filter in the toolbar to see them all."))
            } else if list != nil {
                ContentUnavailableView("Nothing in \(title(list))", systemImage: "doc.text",
                                       description: Text("No invoice is in this list now."))
            } else {
                ContentUnavailableView("No Invoices Yet", systemImage: "doc.text",
                                       description: Text("Make a sale with \u{2318}N."))
            }
        }
    }

    // MARK: The toolbar

    /// New Sale and the one Filter menu. The picked invoice's actions are the inspector's, the Invoice menu's and the
    /// right-click menu's, never the toolbar's.
    @ToolbarContentBuilder
    private func toolbarItems(_ cx: MacInvoiceContext) -> some ToolbarContent {
        ToolbarItemGroup(placement: .automatic) {
            Button { cx.open(Route(path: "/invoices/new")) } label: { Label("New Sale", systemImage: "plus") }
                .help("New sale (\u{2318}N)")
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
            Picker("Sort By", selection: $sort) {
                ForEach(MacInvoicesSort.allCases) { (o: MacInvoicesSort) in Text(o.title).tag(o) }
            }
            .pickerStyle(.inline)
            Picker("Taken By", selection: $takenBy) {
                Text("Anyone").tag("")
                ForEach(who, id: \.self) { (p: String) in Text(p).tag(p) }
            }
            .pickerStyle(.inline)
            Picker("Source", selection: $source) {
                Text("Every Source").tag("")
                ForEach(channelNames, id: \.self) { (s: String) in Text(s).tag(s) }
            }
            .pickerStyle(.inline)
            if filtering {
                Divider()
                Button("Clear Filters") { takenBy = ""; source = "" }
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

    /// What the rows depend on: the books, the search, the list and the filters, and the hour (the words "Today" and
    /// "Yesterday", and how old an owed bill is, move with the clock). The sort is not: it only reorders them.
    private func rowsKey(_ list: String?) -> [Int] {
        [book.invoices.revision, book.customers.revision, query.hashValue, (list ?? "").hashValue,
         takenBy.hashValue, source.hashValue, Int(Date().timeIntervalSince1970 / 3_600)]
    }

    private func build(_ list: String?) -> MacInvoicesPlaceTable {
        let words = query.lowercased().split(whereSeparator: { $0 == " " }).map(String.init)
        // The words each invoice can be found by are read off the books once, and only when something is typed.
        var hay: [String: MacInvoicesPlaceHay] = [:]
        if !words.isEmpty {
            hay = hays([book.invoices.revision, book.customers.revision]) {
                var found: [String: MacInvoicesPlaceHay] = [:]
                found.reserveCapacity(book.invoices.items.count)
                for inv in book.invoices.items { found[inv.id] = haystack(inv) }
                return found
            }
        }
        var rows: [MacInvoicesPlaceRow] = []
        var billed = 0.0
        var owed = 0.0
        let now = Date()
        for inv in MacLists.invoices(book.invoices.items, list: list) {
            if !takenBy.isEmpty && (inv.takenBy ?? "") != takenBy { continue }
            let channel = MacInvoiceWords.source(inv) ?? ""
            if !source.isEmpty && channel != source { continue }
            if !words.isEmpty && !matches(hay[inv.id] ?? haystack(inv), words) { continue }
            let status = MacInvoiceWords.status(inv)
            let due = isOwing(inv) ? inv.balanceDue : 0
            billed += invoiceSaleValue(inv)
            owed += due
            rows.append(MacInvoicesPlaceRow(
                id: inv.id, customer: InvoiceFacts.customerName(inv), createdAt: inv.createdAt,
                dateText: ShopDate.say(inv.createdAt), pieces: inv.items.count, total: invoiceSaleValue(inv), paid: inv.amountPaid,
                due: due, statusText: status.text, statusRank: status.rank, tone: status.tone,
                takenBy: inv.takenBy ?? "", source: channel, sold: InvoiceFacts.whatSold(inv) ?? "",
                timeText: InvoiceFacts.time(inv.createdAt), heading: dayHeading(inv.createdAt, now: now),
                whatsapp: MacWhatsAppChip.of(inv)))
        }
        var out = MacInvoicesPlaceTable()
        out.rows = rows
        out.byId = Dictionary(rows.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        out.billed = billed
        out.owed = owed
        return out
    }

    private func dayHeading(_ iso: String, now: Date) -> String {
        guard let d = ERPDate.parse(iso) else { return "No date" }
        return InvoiceCalendar.heading(d, by: .day, now: now)
    }

    /// The rows in the chosen order: by date, a section for each day (the iPhone's list); any other order is one flat run.
    private func groups(_ rows: [MacInvoicesPlaceRow]) -> [MacInvoicesPlaceGroup] {
        switch sort {
        case .date:
            let newest = rows.sorted { $0.createdAt > $1.createdAt }
            var order: [String] = []
            var members: [String: [MacInvoicesPlaceRow]] = [:]
            for r in newest {
                if members[r.heading] == nil { order.append(r.heading) }
                members[r.heading, default: []].append(r)
            }
            return order.map { (t: String) in
                let mine = members[t] ?? []
                return MacInvoicesPlaceGroup(id: t, title: t, rows: mine, billed: mine.reduce(0) { $0 + $1.total })
            }
        case .total:
            return [flat(rows.sorted { $0.total > $1.total })]
        case .owed:
            return [flat(rows.sorted { $0.due > $1.due })]
        case .customer:
            return [flat(rows.sorted { $0.customer.localizedCaseInsensitiveCompare($1.customer) == .orderedAscending })]
        }
    }

    private func flat(_ rows: [MacInvoicesPlaceRow]) -> MacInvoicesPlaceGroup {
        MacInvoicesPlaceGroup(id: "all", title: "", rows: rows, billed: rows.reduce(0) { $0 + $1.total })
    }

    /// Everything somewhere in the invoice a word can be found by: its number, the customer's name and number, a piece's name
    /// or stock number, who took it (the iPhone's search, word by word).
    private func haystack(_ inv: Invoice) -> MacInvoicesPlaceHay {
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
        return MacInvoicesPlaceHay(text: text.joined(separator: " ").lowercased(), digits: digits)
    }

    /// Every word is in the invoice, or a number typed is among its numbers.
    private func matches(_ hay: MacInvoicesPlaceHay, _ words: [String]) -> Bool {
        words.allSatisfy { word in
            if hay.text.contains(word) { return true }
            let typed = CustomerSearch.digitsTyped(word)
            return typed.count >= 3 && word.allSatisfy { $0.isNumber || $0 == "+" } && hay.digits.contains(typed)
        }
    }
}

/// One invoice as the iPhone's list sets it, at a pointer's size: who it was for over what was sold and its number, the
/// worth at the right over the one pill of where its balance stands.
struct MacInvoiceListRow: View {
    let row: MacInvoicesPlaceRow
    let mine: Bool
    /// Not under a day's heading: say the day, not only the time.
    let dated: Bool

    var body: some View {
        HStack(alignment: .center, spacing: pt(12)) {
            Monogram(name: row.customer, size: Monogram.Size.row)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.customer).font(.body).lineLimit(1)
                if !row.sold.isEmpty {
                    Text(row.sold).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                }
                HStack(spacing: pt(6)) {
                    Text([row.id, dated ? row.dateText : row.timeText].filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    if mine { MineTag() }
                    // Where a web order's WhatsApp stands, in its tone, as the ERP's list adds it to the line (one pill a
                    // row: the balance keeps the pill).
                    if let w = row.whatsapp {
                        Label(w.label, systemImage: "message.fill")
                            .font(.caption.weight(.medium)).foregroundStyle(w.tone.color).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                RowAmount(amount: row.total)
                balance
            }
            .fixedSize(horizontal: true, vertical: false)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var balance: some View {
        if row.statusText == "Refunded" {
            Pill("Refunded", tone: .quiet)
        } else if row.statusText == "In credit" {
            Pill("In credit", tone: .credit)
        } else if row.due >= 1 {
            Pill("\(Money.pkr(row.due)) due", tone: row.tone)
        }
    }
}
#endif
