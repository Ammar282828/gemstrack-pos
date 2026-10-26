#if os(macOS)
import SwiftUI
import ERPCore

// Customers as a Mac place (docs/features/mac-design.md, "Customers"): a sortable, multi-select table of everyone on
// file (Name, Phone, City, Last sale, Spent, Owed, Came from; the sizes are the inspector's), the saved lists Owe Us and
// Recent from the sidebar, a summary bar, the picked customer in the inspector, and the Customer menu. The toolbar is New
// and, for an owner, one Tidy Up menu; the picked customer's actions are the inspector's, the menu bar's and the right-click
// menu's. It replaces the hub's plain table and the Overview page. What a customer owes and has spent is CustomerKit's (the ERP's one figure, lib/owed.ts);
// removing, merging and cleaning up are the owner's, through the same sheets and writes as the iPhone.

/// One customer as a row of the table.
struct MacCustomersRow: Identifiable {
    let customer: Customer
    let name: String
    let phone: String
    let city: String
    let lastAt: String
    let spent: Double
    let owed: Double
    let source: String
    let ring: String
    var id: String { customer.id }

    init(_ c: Customer, stats: CustomerKit.Stats?) {
        customer = c
        name = CustomerKit.shown(c)
        phone = CustomerKit.filled(c.phone) ?? ""
        city = CustomerKit.filled(c.city) ?? ""
        lastAt = stats?.lastAt ?? ""
        spent = stats?.spent ?? 0
        owed = stats?.owed ?? 0
        source = c.source.map { (s: CustomerSource) -> String in CustomerKit.sourceLabel(s) } ?? ""
        ring = CustomerKit.filled(c.ringSize) ?? ""
    }
}

/// What every customer owes and has bought, worked out once per change of the books.
struct MacCustomersBooks {
    let owed: Owed
    let stats: [String: CustomerKit.Stats]
}

/// A customer's latest invoices and orders, for the inspector.
struct MacCustomersRecent {
    let invoices: [Invoice]
    let invoiceCount: Int
    let orders: [Order]
    let orderCount: Int
}

private struct MacCustomersEdit: Identifiable {
    let id: String
}

struct MacCustomersPlace: View {
    /// "/customers" or a saved list of it ("/customers?list=owe").
    let path: String

    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var query = ""
    @State private var sort: [KeyPathComparator<MacCustomersRow>]
    @State private var selection = Set<String>()
    @State private var reckoned = Memo<MacCustomersBooks>()
    @State private var made = Memo<[MacCustomersRow]>()
    @State private var ordered = Memo<[MacCustomersRow]>()
    @State private var nearby = Memo<MacCustomersRecent>()
    @State private var adding = false
    @State private var editing: MacCustomersEdit?
    @State private var merging = false
    @State private var cleaning = false
    @State private var deletion: OwnerDeletion?
    @State private var note: Note?
    @State private var pushed: Route?

    init(path: String) {
        self.path = path
        let owing = MacLists.list(in: path) == "owe"
        let first: [KeyPathComparator<MacCustomersRow>] = owing
            ? [KeyPathComparator(\MacCustomersRow.owed, order: .reverse)]
            : [KeyPathComparator(\MacCustomersRow.name)]
        _sort = State(initialValue: first)
    }

    private var listId: String? { MacLists.list(in: path) }

    private var loaded: Bool {
        book.customers.loaded && book.invoices.loaded && book.orders.loaded && (!session.isOwner || book.hisaab.loaded)
    }

    private var failure: String? {
        book.customers.error ?? book.invoices.error ?? book.orders.error ?? (session.isOwner ? book.hisaab.error : nil)
    }

    private var title: String {
        let lists = MacLists.lists(for: "/customers")
        return lists.first { (l: MacSavedList) in l.id == listId }?.title ?? "Customers"
    }

    var body: some View {
        let b = reckon()
        let rows = tableRows(b)
        ShelfState(loaded: loaded, error: failure, offline: book.customers.offline || book.invoices.offline) {
            table(rows, b)
        }
        .navigationTitle(title)
        .navigationSubtitle(loaded ? "\(rows.count) customer\(rows.count == 1 ? "" : "s")" : "")
        .macSearchable(text: $query, prompt: "Search Customers")
        .macInspector { inspector(b) }
        .toolbar { toolbar }
        .macRecordMenu(MacRecordMenu(title: "Customer", groups: actionGroups(for: selection)))
        .sheet(isPresented: $adding) { MacCustomersNewSheet { (id: String) in created(id) } }
        .sheet(item: $editing) { (e: MacCustomersEdit) in editSheet(e.id) }
        .sheet(isPresented: $merging) { CustomerMergeSheet().presentationSizing(.page) }
        .sheet(isPresented: $cleaning) { CustomerSpamSheet().presentationSizing(.page) }
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
                .presentationSizing(.form)
        }
        .noteToast($note)
        .navigationDestination(item: $pushed) { (r: Route) in PlaceScreen(path: r.path) }
        .task {
            book.customers.need()
            book.invoices.need()
            book.orders.need()
            if session.isOwner { book.hisaab.need() }
        }
    }

    // MARK: Worked out once per change of the books

    private func reckon() -> MacCustomersBooks {
        let key = [book.customers.revision, book.invoices.revision, book.orders.revision, book.hisaab.revision, session.isOwner ? 1 : 0]
        return reckoned(key) {
            let ledger: [HisaabEntry]? = session.isOwner ? book.hisaab.items : nil
            let owed = CustomerKit.owed(invoices: book.invoices.items, customers: book.customers.items, ledger: ledger)
            let stats = CustomerKit.stats(invoices: book.invoices.items, orders: book.orders.items, owed: owed)
            return MacCustomersBooks(owed: owed, stats: stats)
        }
    }

    private func tableRows(_ b: MacCustomersBooks) -> [MacCustomersRow] {
        let list = listId
        let key = [book.customers.revision, book.invoices.revision, book.orders.revision, book.hisaab.revision,
                   session.isOwner ? 1 : 0, query.hashValue, (list ?? "").hashValue]
        let rows = made(key) {
            let people = MacLists.customers(book.customers.items, list: list, invoices: book.invoices.items)
            var out: [MacCustomersRow] = []
            out.reserveCapacity(people.count)
            for c in people where CustomerKit.matches(c, query) {
                out.append(MacCustomersRow(c, stats: b.stats[c.id]))
            }
            return out
        }
        // The sort alone only puts the same rows in another order.
        return ordered(key + [sort.hashValue]) { rows.sorted(using: sort) }
    }

    private func recent(for id: String) -> MacCustomersRecent {
        nearby([book.invoices.revision, book.orders.revision, id.hashValue]) {
            // The shelves hold the newest first.
            let invoices = book.invoices.items.filter { (i: Invoice) in i.customerId == id }
            let orders = book.orders.items.filter { (o: Order) in o.customerId == id }
            return MacCustomersRecent(invoices: Array(invoices.prefix(6)), invoiceCount: invoices.count,
                                      orders: Array(orders.prefix(6)), orderCount: orders.count)
        }
    }

    // MARK: The table

    private func table(_ rows: [MacCustomersRow], _ b: MacCustomersBooks) -> some View {
        Table(rows, selection: $selection, sortOrder: $sort) {
            TableColumn("Name", value: \.name) { (r: MacCustomersRow) in Text(r.name).lineLimit(1) }
                .width(min: 120, ideal: 200)
            TableColumn("Phone", value: \.phone) { (r: MacCustomersRow) in Text(r.phone).monospacedDigit().lineLimit(1) }
                .width(min: 100, ideal: 120)
            TableColumn("City", value: \.city) { (r: MacCustomersRow) in Text(r.city).lineLimit(1) }
                .width(min: 70, ideal: 100)
            TableColumn("Last Sale", value: \.lastAt) { (r: MacCustomersRow) in
                Text(CustomerKit.monthYear(r.lastAt)).lineLimit(1)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Spent", value: \.spent) { (r: MacCustomersRow) in
                MacAmount(r.spent > 0 ? r.spent : nil)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Owed", value: \.owed) { (r: MacCustomersRow) in
                // Only what needs someone is coloured.
                MacAmount(r.owed >= 1 ? r.owed : nil, tone: .owed)
            }
            .width(min: 70, ideal: 90)
            TableColumn("Came From", value: \.source) { (r: MacCustomersRow) in Text(r.source).lineLimit(1) }
                .width(min: 80, ideal: 100)
        }
        .contextMenu(forSelectionType: String.self) { (ids: Set<String>) in
            contextItems(ids)
        } primaryAction: { (ids: Set<String>) in
            for id in ids.prefix(5) { go(CustomerKit.route(id)) }
        }
        .overlay { if rows.isEmpty { emptyState } }
        .macSummaryBar(summary(rows, b))
    }

    @ViewBuilder
    private var emptyState: some View {
        if !CustomerKit.trim(query).isEmpty {
            ContentUnavailableView.search(text: query)
        } else if listId == "owe" {
            ContentUnavailableView("Nobody owes you", systemImage: "checkmark.circle", description: Text("Every customer is settled."))
        } else if listId == "recent" {
            ContentUnavailableView("No recent buyers", systemImage: "clock", description: Text("Nobody has bought in the last 90 days."))
        } else {
            ContentUnavailableView("No Customers Yet", systemImage: "person.2", description: Text("Add one with \u{2303}\u{2318}N."))
        }
    }

    private func summary(_ rows: [MacCustomersRow], _ b: MacCustomersBooks) -> [String] {
        if selection.count > 1 {
            let picked = rows.filter { (r: MacCustomersRow) in selection.contains(r.id) }
            let owed = picked.reduce(0.0) { (sum: Double, r: MacCustomersRow) in sum + r.owed }
            let spent = picked.reduce(0.0) { (sum: Double, r: MacCustomersRow) in sum + r.spent }
            var parts = ["\(picked.count) selected"]
            if owed >= 1 { parts.append("\(Money.pkr(owed)) owed") }
            if spent > 0 { parts.append("\(Money.pkrLac(spent)) spent") }
            return parts
        }
        var parts = ["\(rows.count) customer\(rows.count == 1 ? "" : "s")"]
        let whole = listId == nil && CustomerKit.trim(query).isEmpty
        // The whole book says the ERP's one figure, walk-ins and typed names in it; a list or a search says what its rows owe.
        let owed = whole ? b.owed.total : rows.reduce(0.0) { (sum: Double, r: MacCustomersRow) in sum + r.owed }
        if owed >= 1 { parts.append("\(Money.pkr(owed)) owed") }
        if whole {
            if b.owed.walkIn >= 1 { parts.append("walk-ins \(Money.pkr(b.owed.walkIn))") }
            if b.owed.nameOnly >= 1 { parts.append("typed names \(Money.pkr(b.owed.nameOnly))") }
            if session.isOwner && b.owed.ledger >= 1 { parts.append("hisaab \(Money.pkr(b.owed.ledger))") }
        }
        return parts
    }

    // MARK: Opening

    /// A customer, or what belongs to them, in a window of its own; in the main window's detail where windows are not offered.
    private func go(_ route: Route) {
        if let openPlace { openPlace(route) } else { pushed = route }
    }

    /// The customer just saved: their window opens, and the row is picked once the book brings them.
    private func created(_ id: String) {
        guard !id.isEmpty else { return }
        selection = [id]
        go(CustomerKit.route(id))
    }

    // MARK: The actions, declared once

    private func customer(_ ids: Set<String>) -> Customer? {
        guard ids.count == 1, let id = ids.first, let c = book.customers.item(id), !CustomerKit.isRemoved(c) else { return nil }
        return c
    }

    private var newAction: MacAction {
        MacAction("New Customer…", symbol: "person.badge.plus",
                  shortcut: KeyboardShortcut("n", modifiers: [.control, .command]), id: "new") { adding = true }
    }

    private func actionGroups(for ids: Set<String>) -> [[MacAction]] {
        let one = customer(ids)
        let owner = session.isOwner
        var groups: [[MacAction]] = [[newAction]]
        if owner { groups.append([editAction(one)]) }
        groups.append(contactActions(one, hisaab: owner))
        if owner {
            groups.append([mergeAction, cleanAction])
            groups.append([removeAction(one)])
        }
        return groups
    }

    private func editAction(_ one: Customer?) -> MacAction {
        MacAction("Edit…", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command),
                  enabled: one != nil, id: "edit") {
            if let one { editing = MacCustomersEdit(id: one.id) }
        }
    }

    private func contactActions(_ one: Customer?, hisaab: Bool) -> [MacAction] {
        let call = one.flatMap { (c: Customer) -> URL? in CustomerKit.callURL(c.phone) }
        let whatsApp = one.flatMap { (c: Customer) -> URL? in CustomerKit.whatsAppURL(c.phone) }
        let message = one.flatMap { (c: Customer) -> URL? in CustomerKit.messageURL(c.phone) }
        var out: [MacAction] = [
            MacAction("Call", symbol: "phone", enabled: call != nil, id: "call") { if let call { openURL(call) } },
            MacAction("WhatsApp", symbol: "message", enabled: whatsApp != nil, id: "whatsapp") { if let whatsApp { openURL(whatsApp) } },
            MacAction("Message", symbol: "text.bubble", enabled: message != nil, id: "message") { if let message { openURL(message) } },
        ]
        if hisaab {
            out.append(MacAction("Open Hisaab", symbol: "book.closed", enabled: one != nil, id: "hisaab") {
                if let one { go(Route(path: CustomerKit.hisaabPath(one.id))) }
            })
        }
        return out
    }

    private var mergeAction: MacAction {
        MacAction("Merge Duplicates…", symbol: "person.2", id: "merge") { merging = true }
    }

    private var cleanAction: MacAction {
        MacAction("Clean Up Spam…", symbol: "person.crop.circle.badge.xmark", id: "clean") { cleaning = true }
    }

    private func removeAction(_ one: Customer?) -> MacAction {
        MacAction("Remove Customer…", symbol: "person.badge.minus", shortcut: KeyboardShortcut(.delete, modifiers: .command),
                  role: .destructive, enabled: one != nil, id: "remove") {
            if let one { askToRemove(one) }
        }
    }

    /// Says what stays with them before it asks for the code, then hides them: the customer page's own words and write.
    private func askToRemove(_ c: Customer) {
        let invoices = book.invoices.items.filter { (i: Invoice) in i.customerId == c.id }.count
        let orders = book.orders.items.filter { (o: Order) in o.customerId == c.id }.count
        let rows = session.isOwner
            ? book.hisaab.items.filter { (e: HisaabEntry) in e.entityType == .customer && e.entityId == c.id }.count
            : 0
        let owed = reckon().stats[c.id]?.owed ?? 0
        let counts = CustomerMergeCounts(invoices: invoices, orders: orders, hisaab: rows, given: 0)
        deletion = CustomerKit.macRemoval(of: c, counts: counts, owing: owed) {
            Note.show(Note(title: "\(CustomerKit.shown(c)) removed", detail: "Settings, then Recently removed, puts them back."),
                      in: $note, reduce: reduceMotion)
        }
    }

    // MARK: Menus, toolbar, sheets

    @ViewBuilder
    private func contextItems(_ ids: Set<String>) -> some View {
        if ids.isEmpty {
            MacActionItems(groups: [[newAction]])
        } else {
            MacActionItems(groups: actionGroups(for: ids))
            Divider()
            Button("Open in New Window") { for id in ids.prefix(5) { go(CustomerKit.route(id)) } }
            Button("Copy Phone Number") {
                if let c = customer(ids) { UIPasteboard.general.string = CustomerKit.filled(c.phone) ?? "" }
            }
            .disabled(customer(ids).flatMap { (c: Customer) -> String? in CustomerKit.filled(c.phone) } == nil)
        }
    }

    /// New, and for an owner the one Tidy Up menu (merging and cleaning up are about the whole book, not one customer).
    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .automatic) {
            Button { adding = true } label: { Label("New Customer", systemImage: "plus") }
                .help("New customer (\u{2303}\u{2318}N)")
            if session.isOwner {
                Menu {
                    MacActionMenuItem(action: mergeAction)
                    MacActionMenuItem(action: cleanAction)
                } label: {
                    Label("Tidy Up", systemImage: "ellipsis.circle")
                }
                .help("Merge duplicates or clean up spam")
            }
        }
    }

    private func editSheet(_ id: String) -> some View {
        NavigationStack {
            EditCustomer(id: id)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { editing = nil }
                    }
                }
        }
        .frame(minWidth: 560, idealWidth: 720, minHeight: 520, idealHeight: 640)
    }

    // MARK: The inspector

    @ViewBuilder
    private func inspector(_ b: MacCustomersBooks) -> some View {
        if let c = customer(selection) {
            MacCustomersInspector(
                customer: c,
                owed: b.stats[c.id]?.owed ?? 0,
                recent: recent(for: c.id),
                actions: contactActions(c, hisaab: session.isOwner),
                open: { (r: Route) in go(r) })
        } else if selection.count > 1 {
            MacInspectorEmpty(title: "\(selection.count) Customers Selected")
        } else {
            MacInspectorEmpty(title: "No Customer Selected")
        }
    }
}

// MARK: - The inspector's panel

/// The picked customer: a plain head (name, number, what they owe), Call, WhatsApp, Message and Hisaab, then their contact
/// details, sizes, and their latest invoices and orders as compact rows that open in a window of their own.
private struct MacCustomersInspector: View {
    let customer: Customer
    let owed: Double
    let recent: MacCustomersRecent
    let actions: [MacAction]
    let open: (Route) -> Void

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                MacInspectorHeader(title: CustomerKit.shown(customer), subtitle: CustomerKit.filled(customer.phone), headline: headline)
                buttons
            }
            .padding(16)
            Divider()
            Form {
                contactSection
                sizesSection
                invoicesSection
                ordersSection
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
    }

    private var headline: MacHeadline? {
        owed >= 1 ? MacHeadline("Owed", Money.pkr(owed), tone: .owed) : nil
    }

    private var buttons: some View {
        ViewThatFits(in: .horizontal) {
            MacActionButtons(actions: actions)
            VStack(alignment: .leading, spacing: 6) {
                MacActionButtons(actions: Array(actions.prefix(2)))
                MacActionButtons(actions: Array(actions.dropFirst(2)))
            }
        }
    }

    @ViewBuilder
    private var contactSection: some View {
        let c = customer
        let address = [c.address, c.city, c.country].compactMap { (s: String?) -> String? in CustomerKit.filled(s) }.joined(separator: ", ")
        Section("Contact") {
            if let v = CustomerKit.filled(c.phone) { LabeledContent("Phone", value: v) }
            if let v = CustomerKit.filled(c.altPhone) { LabeledContent("Second number", value: v) }
            if let v = CustomerKit.filled(c.email) { LabeledContent("Email", value: v) }
            if !address.isEmpty { LabeledContent("Address", value: address) }
            if let s = c.source { LabeledContent("Came from", value: CustomerKit.sourceLabel(s)) }
        }
    }

    @ViewBuilder
    private var sizesSection: some View {
        let ring = CustomerKit.filled(customer.ringSize)
        let bangle = CustomerKit.filled(customer.bangleSize)
        let bracelet = CustomerKit.filled(customer.braceletSize)
        let chain = CustomerKit.filled(customer.chainLength)
        if ring != nil || bangle != nil || bracelet != nil || chain != nil {
            Section("Sizes") {
                if let ring { LabeledContent("Ring", value: ring) }
                if let bangle { LabeledContent("Bangle", value: bangle) }
                if let bracelet { LabeledContent("Bracelet", value: bracelet) }
                if let chain { LabeledContent("Chain", value: chain) }
            }
        }
    }

    @ViewBuilder
    private var invoicesSection: some View {
        if !recent.invoices.isEmpty {
            Section("Recent Invoices") {
                ForEach(recent.invoices) { (inv: Invoice) in
                    MacCustomersMiniRow(title: inv.id, subtitle: ShopDate.say(inv.createdAt),
                                        trailing: Money.pkr(invoiceSaleValue(inv)), flag: invoiceFlag(inv)) {
                        open(CustomerKit.place("/invoices/", inv.id))
                    }
                }
                if recent.invoiceCount > recent.invoices.count {
                    Text("\(recent.invoiceCount) in all, in the customer's window.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var ordersSection: some View {
        if !recent.orders.isEmpty {
            Section("Recent Orders") {
                ForEach(recent.orders) { (o: Order) in
                    MacCustomersMiniRow(title: o.id, subtitle: ShopDate.say(o.createdAt),
                                        trailing: Money.pkr(o.grandTotal), flag: nil) {
                        open(CustomerKit.place("/orders/", o.id))
                    }
                }
                if recent.orderCount > recent.orders.count {
                    Text("\(recent.orderCount) in all, in the customer's window.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    /// "owes PKR 5,000" on an invoice still owing; nothing for a settled one.
    private func invoiceFlag(_ inv: Invoice) -> String? {
        let line = balanceLine(inv.balanceDue)
        if inv.status == .refunded { return "refunded" }
        return line.state == .due ? "owes \(Money.pkr(line.amount))" : nil
    }
}

/// A record in the inspector in one compact row: its number and date, its amount, a word when it needs someone.
private struct MacCustomersMiniRow: View {
    let title: String
    let subtitle: String
    let trailing: String
    let flag: String?
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).monospacedDigit().lineLimit(1)
                    Text(subtitle.isEmpty ? " " : subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(trailing).monospacedDigit()
                    if let flag { Text(flag).font(.caption).foregroundStyle(Tone.owed.color) }
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Open in a window")
    }
}

// MARK: - New customer

/// New Customer…: the add form as a sheet over the table. Saving closes it and tells the place the new customer's id.
private struct MacCustomersNewSheet: View {
    let created: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            AddCustomer()
                .afterSaving { (id: String) in
                    dismiss()
                    created(id)
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                            .keyboardShortcut(.cancelAction)
                    }
                }
        }
        .frame(minWidth: 460, idealWidth: 480, minHeight: 460)
    }
}
#endif
