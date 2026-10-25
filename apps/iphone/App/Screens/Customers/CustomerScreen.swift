import SwiftUI
import ERPCore

/// One customer (src/app/customers/[id]/page.tsx), and what the web page leaves you to hunt for:
/// what they owe (the list's own figure, lib/owed.ts), their repairs, and a hisaab for owners.
/// A removed customer is not shown (store.ts splitRemoved): the web says "not found"; this says
/// they were removed, since Settings > Recently removed puts them back.
///
/// Remove is native for an owner (`removeCustomer`, lib/writes/customer-admin.ts): it hides the customer, and
/// the ERP checks the delete code with it. The sheet says what stays with them first.
struct CustomerScreen: View {
    let id: String
    @Environment(Book.self) private var book
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    /// A customer just made on this phone, shown until the shelf brings them (staff poll every 25 seconds).
    private let seed: Customer?
    @State private var deletion: OwnerDeletion?
    @State private var note: Note?
    /// An invoice whose credit is being handed back (InvoiceActionCreditSheet).
    @State private var givingBack: Invoice?
    /// The customer's figures, worked out once per change of the books rather than on every drawing (every
    /// invoice, order, repair and hisaab row was walked each time the page moved).
    @State private var reckoned = Memo<Facts>()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(macOS)
    // The Mac record window: which tab of tables is open, the picked row, and where a double-click goes.
    @Environment(\.openPlaceWindow) private var openPlace
    @State private var macTab: CustomerMacTab = .invoices
    @State private var macPick = Set<String>()
    @State private var macGo: Route?
    @State private var macEditing = false
    #endif

    init(id: String, seed: Customer? = nil) {
        self.id = id
        self.seed = seed
    }

    private struct Facts {
        let customer: Customer
        let invoices: [Invoice]
        let orders: [Order]
        let repairs: [Repair]
        let hisaab: [HisaabEntry]
        let owing: CustomerKit.Owing
    }

    // `item(_:)` reads `items` first, so the page still redraws when the customers arrive, and finds them at once
    // rather than walking the whole book on every drawing.
    private var customer: Customer? { book.customers.item(id) ?? seed }

    private var ledger: [HisaabEntry]? { session.isOwner ? book.hisaab.items : nil }

    private var loaded: Bool {
        if seed != nil { return true }
        return book.customers.loaded && book.invoices.loaded && book.orders.loaded && book.repairs.loaded
            && (!session.isOwner || book.hisaab.loaded)
    }

    private var failure: String? {
        book.customers.error ?? book.invoices.error ?? book.orders.error ?? book.repairs.error
            ?? (session.isOwner ? book.hisaab.error : nil)
    }

    var body: some View {
        ShelfState(loaded: loaded, error: failure, offline: book.customers.offline) {
            content
        }
        .navigationTitle(customer.map { CustomerKit.shown($0) } ?? "Customer")
        .navigationBarTitleDisplayMode(.inline)
        .zoomDestination(id: CustomerKit.path(id))
        #if !os(macOS)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                // Editing a profile is an owner's: the shop floor has no write to it, in the ERP or here.
                if let c = customer, !CustomerKit.isRemoved(c), session.isOwner {
                    NavigationLink(value: Route(path: CustomerKit.path(c.id, suffix: "/edit"))) {
                        Text("Edit")
                    }
                    #if os(macOS)
                    .keyboardShortcut("e", modifiers: .command)
                    .help("Edit this customer (\u{2318}E)")
                    #endif
                }
            }
        }
        #endif
        .sheet(item: $deletion) { (d: OwnerDeletion) in
            OwnerDeleteCodeSheet(deletion: d) {}
                .presentationSizing(.form)
        }
        .sheet(item: $givingBack) { (inv: Invoice) in
            InvoiceActionCreditSheet(invoice: inv) { (o: InvoiceActionOutcome) in
                Note.show(Note(title: o.note.title, detail: o.note.detail), in: $note, reduce: reduceMotion)
            }
            .presentationSizing(.form)
        }
        .noteToast($note)
        .destructiveFeedback(trigger: deletion != nil)
        .task {
            book.customers.need()
            book.invoices.need()
            book.orders.need()
            book.repairs.need()
            if session.isOwner { book.hisaab.need() }
        }
    }

    @ViewBuilder private var content: some View {
        if let c = customer {
            if CustomerKit.isRemoved(c) {
                NotAvailableState("Removed", why: "\(CustomerKit.shown(c)) was removed. Settings, then Recently removed, puts them back.",
                                  symbol: "person.crop.circle.badge.minus")
            } else {
                #if os(macOS)
                macPage(facts(for: c))
                #else
                page(facts(for: c))
                #endif
            }
        } else {
            NotAvailableState("Customer not found", why: "They are not in the book on this phone.",
                              symbol: "person.crop.circle.badge.questionmark")
        }
    }

    private func facts(for c: Customer) -> Facts {
        reckoned([book.invoices.revision, book.orders.revision, book.repairs.revision, book.hisaab.revision,
                  book.customers.revision, session.isOwner ? 1 : 0, c.id.hashValue]) { reckon(c) }
    }

    private func reckon(_ c: Customer) -> Facts {
        let owed = CustomerKit.owed(invoices: book.invoices.items, customers: book.customers.items, ledger: ledger)
        let mine = book.hisaab.items.filter { $0.entityType == .customer && $0.entityId == c.id }
        return Facts(
            customer: c,
            invoices: book.invoices.items.filter { $0.customerId == c.id },
            orders: book.orders.items.filter { $0.customerId == c.id },
            repairs: book.repairs.items.filter { $0.customerId == c.id },
            hisaab: session.isOwner ? mine : [],
            owing: CustomerKit.owing(c.id, owed: owed, ledger: ledger)
        )
    }

    private func page(_ f: Facts) -> some View {
        // An iPad's wide window: who they are and what they owe on the left, their invoices, orders and hisaab right.
        WideDetailList {
            Section {
                header(f.customer)
                    .listRowBackground(Color.clear)
            }
            .houseRows()
            Group { owedSection(f.owing) }.houseRows()
        } right: { Group {
            invoicesSection(f.invoices)
            ordersSection(f.orders)
            repairsSection(f.repairs)
            if session.isOwner { hisaabSection(f.hisaab, id: f.customer.id) }
            detailsSection(f.customer)
            sizesSection(f.customer)
            // Removing is an owner's, as the web's direct write is.
            if session.isOwner {
                Section {
                    Button(role: .destructive) { askToRemove(f) } label: {
                        Label("Remove this customer", systemImage: "person.badge.minus")
                    }
                } footer: {
                    Text("Removing hides them; their invoices, orders and hisaab stay, and Settings, then Recently removed, puts them back. It asks for the delete code.")
                }
            }
        }.houseRows()
        }
    }

    /// Says what stays with them before it asks for the code (the web's confirmation), then hides them.
    private func askToRemove(_ f: Facts) {
        let c = f.customer
        let name = CustomerKit.shown(c)
        let stays = CustomerMergeCounts(invoices: f.invoices.count, orders: f.orders.count, hisaab: f.hisaab.count, given: 0).sentence
        var detail = stays == "nothing"
            ? "\(name) will be hidden from the lists."
            : "\(name) will be hidden from the lists. Their \(stays) stay where they are."
        if f.owing.total >= 1 { detail += " They still owe \(Money.pkr(f.owing.total))." }
        detail += " Settings, then Recently removed, puts them back."
        deletion = OwnerDeletion(what: "Delete customer \(name)", detail: detail, final: false) { code in
            _ = try await ERPAPI.shared.write("removeCustomer", ["customerId": c.id, "deleteCode": code])
            Note.show(Note(title: "\(name) removed", detail: "Settings, then Recently removed, puts them back."),
                      in: $note, reduce: reduceMotion)
        }
    }

    // MARK: Who, and how to reach them

    private func header(_ c: Customer) -> some View {
        VStack(spacing: pt(14)) {
            VStack(spacing: pt(8)) {
                Monogram(name: CustomerKit.shown(c), size: 56)
                Text(CustomerKit.shown(c))
                    .font(.system(.title2, design: .serif).weight(.semibold))
                    .multilineTextAlignment(.center)
                if let phone = CustomerKit.filled(c.phone) {
                    Text(phone).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            HStack(spacing: pt(10)) {
                contact("Call", "phone.fill", CustomerKit.callURL(c.phone))
                contact("WhatsApp", "message.fill", CustomerKit.whatsAppURL(c.phone))
                contact("Message", "text.bubble.fill", CustomerKit.messageURL(c.phone))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, pt(4))
    }

    private func contact(_ title: String, _ symbol: String, _ url: URL?) -> some View {
        Button {
            if let url { openURL(url) }
        } label: {
            VStack(spacing: pt(4)) {
                Image(systemName: symbol).font(.title3)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .largeOnPhone()
        .disabled(url == nil)
    }

    // MARK: Owed

    @ViewBuilder private func owedSection(_ o: CustomerKit.Owing) -> some View {
        Section {
            VStack(alignment: .leading, spacing: pt(12)) {
                Text("Owed to you").font(.subheadline).foregroundStyle(.secondary)
                HeroAmount(amount: o.total)
                if !owedDetail(o).isEmpty {
                    Text(owedDetail(o)).font(.footnote).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
                .heroSheen()
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
        }
    }

    private func owedDetail(_ o: CustomerKit.Owing) -> String {
        var parts: [String] = []
        if o.onInvoices >= 1 {
            parts.append("On \(o.invoiceCount) invoice\(o.invoiceCount == 1 ? "" : "s") \(Money.pkr(o.onInvoices))")
        }
        if o.inHisaab >= 1 { parts.append("In the hisaab \(Money.pkr(o.inHisaab))") }
        if o.shopOwesThem >= 1 { parts.append("The hisaab owes them \(Money.pkr(o.shopOwesThem))") }
        return parts.joined(separator: " · ")
    }

    // MARK: Details and sizes

    private func detailsSection(_ c: Customer) -> some View {
        let address = [c.address, c.city, c.country].compactMap { CustomerKit.filled($0) }.joined(separator: ", ")
        return Section {
            DisclosureGroup("Customer details") {
                if let phone = CustomerKit.filled(c.phone) { LabeledContent("Phone", value: phone) }
                if let alt = CustomerKit.filled(c.altPhone) { LabeledContent("Second number", value: alt) }
                if let email = CustomerKit.filled(c.email) { LabeledContent("Email", value: email) }
                if !address.isEmpty { LabeledContent("Address", value: address) }
                if let source = c.source { LabeledContent("Source", value: CustomerKit.sourceLabel(source)) }
                if let birthday = CustomerKit.filled(c.birthday) { LabeledContent("Birthday", value: CustomerKit.day(birthday)) }
                if let anniversary = CustomerKit.filled(c.anniversary) { LabeledContent("Anniversary", value: CustomerKit.day(anniversary)) }
                if let preference = CustomerKit.filled(c.preference) { LabeledContent("Prefers", value: preference) }
                if let notes = CustomerKit.filled(c.notes) { LabeledContent("Notes", value: notes) }
            }
        }
        .houseRows()
    }

    /// One line on the web ("Ring 14 · Bangle 2.6"): here a row each, and no section when none is on file.
    @ViewBuilder private func sizesSection(_ c: Customer) -> some View {
        let ring = CustomerKit.filled(c.ringSize)
        let bangle = CustomerKit.filled(c.bangleSize)
        let bracelet = CustomerKit.filled(c.braceletSize)
        let chain = CustomerKit.filled(c.chainLength)
        if ring != nil || bangle != nil || bracelet != nil || chain != nil {
            LedgerSection("Sizes", collapsible: true) {
                if let ring { LabeledContent("Ring", value: ring) }
                if let bangle { LabeledContent("Bangle", value: bangle) }
                if let bracelet { LabeledContent("Bracelet", value: bracelet) }
                if let chain { LabeledContent("Chain", value: chain) }
            }
        }
    }

    // MARK: Their invoices, orders, repairs

    private func invoicesSection(_ list: [Invoice]) -> some View {
        Section {
            if list.isEmpty {
                Text("No sales history found for this customer.").foregroundStyle(.secondary)
            } else {
                ForEach(list) { inv in
                    NavigationLink(value: CustomerKit.place("/invoices/", inv.id)) {
                        CustInvoiceRow(invoice: inv)
                    }
                    // Credit they have paid ahead: the owner can hand it back (decision "Invoice credit").
                    .swipeActions(edge: .trailing) {
                        if session.isOwner && InvoiceCredit.held(inv) >= 1 {
                            Button { givingBack = inv } label: { Label("Give back", systemImage: "banknote") }
                                .tint(Tone.credit.color)
                        }
                    }
                }
                // Swipe is easy to miss: the same action as a plain row, one per invoice in credit.
                if session.isOwner {
                    ForEach(list.filter { InvoiceCredit.held($0) >= 1 }) { inv in
                        Button { givingBack = inv } label: {
                            Label("Give back \(Money.pkr(InvoiceCredit.held(inv))) on \(inv.id)", systemImage: "banknote")
                        }
                    }
                }
            }
        } header: {
            LedgerHeading(title: "Invoices", count: list.count)
        }
    }

    // No orders or no repairs: no section, the absence is the message.
    @ViewBuilder private func ordersSection(_ list: [Order]) -> some View {
        if !list.isEmpty {
            Section {
                ForEach(list) { order in
                    NavigationLink(value: CustomerKit.place("/orders/", order.id)) {
                        CustOrderRow(order: order)
                    }
                }
            } header: {
                LedgerHeading(title: "Orders", count: list.count)
            }
        }
    }

    @ViewBuilder private func repairsSection(_ list: [Repair]) -> some View {
        if !list.isEmpty {
            Section {
                ForEach(list) { repair in
                    NavigationLink(value: CustomerKit.place("/repairs?id=", repair.id)) {
                        CustRepairRow(repair: repair)
                    }
                }
            } header: {
                LedgerHeading(title: "Repairs", count: list.count)
            }
        }
    }

    // MARK: Hisaab (owners)

    private static let hisaabShown = 12

    private func hisaabSection(_ rows: [HisaabEntry], id: String) -> some View {
        Section {
            ForEach(rows.prefix(Self.hisaabShown)) { row in
                CustHisaabRow(entry: row)
            }
            NavigationLink(value: Route(path: CustomerKit.hisaabPath(id))) {
                Label(rows.count > Self.hisaabShown ? "All \(rows.count) rows in their hisaab" : "Open their hisaab", systemImage: "book.closed")
            }
        } header: {
            LedgerHeading(title: "Hisaab")
        }
    }
}

// MARK: Rows

private struct CustInvoiceRow: View {
    let invoice: Invoice

    private var line: BalanceLine { balanceLine(invoice.balanceDue) }
    private var refunded: Bool { invoice.status == .refunded }

    private var subtitle: String {
        var parts = [ShopDate.say(invoice.createdAt)]
        if refunded {
            parts.append("refunded")
        } else if line.state == .due {
            parts.append("owes \(Money.pkr(line.amount))")
        } else if line.state == .credit {
            parts.append("credit \(Money.pkr(line.amount))")
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        TwoLine(title: invoice.id, subtitle: subtitle, trailing: Money.pkr(invoice.grandTotal),
                trailingTint: (!refunded && line.state == .due) ? Tone.owed.color : .primary)
    }
}

private struct CustOrderRow: View {
    let order: Order

    private var closed: Bool { order.status == .cancelled || order.status == .refunded }
    private var invoiced: Bool { !(order.invoiceId ?? "").isEmpty }

    private var subtitle: String {
        var parts = [ShopDate.say(order.createdAt)]
        let n = order.items.count
        if n > 0 { parts.append("\(n) piece\(n == 1 ? "" : "s")") }
        if invoiced { parts.append("invoiced") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        // The order's total is stored net of its advances, so it is the balance still to pay (order-payment.ts).
        HStack(spacing: pt(8)) {
            TwoLine(title: order.id, subtitle: subtitle, trailing: Money.pkr(order.grandTotal),
                    trailingTint: (closed || invoiced) ? .secondary : .primary)
            // Completed is the expected end: no badge for it (rule 15). Open, cancelled and refunded keep theirs.
            if order.status != .completed { StatusBadge(order: order.status) }
        }
    }
}

private struct CustRepairRow: View {
    let repair: Repair

    private var balance: Double { CustomerKit.repairBalance(repair) }
    private var open: Bool { repair.status == .received || repair.status == .ready }

    private var subtitle: String {
        var parts = [repair.id, ShopDate.say(repair.receivedAt)]
        if open, let promised = CustomerKit.filled(repair.promisedDate) { parts.append("promised \(ShopDate.say(promised))") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        let status = CustomerKit.repairStatus(repair.status)
        HStack(spacing: pt(8)) {
            TwoLine(title: CustomerKit.repairSummary(repair), subtitle: subtitle,
                    trailing: (open && balance >= 1) ? Money.pkr(balance) : nil, trailingTint: Tone.owed.color)
            // Collected is the expected end: no pill for it (rule 15).
            if repair.status != .collected { Pill(status.text, tone: status.tone) }
        }
    }
}

private struct CustHisaabRow: View {
    let entry: HisaabEntry

    private var net: Double { entry.cashDebit - entry.cashCredit }

    private var subtitle: String {
        var parts = [ShopDate.say(entry.date)]
        // The house's own metal: the hisaab's "gold" columns hold silver in House of Mina (STORE_METAL_WORD).
        if entry.goldDebitGrams > 0 { parts.append("gave \(CustomerKit.grams(entry.goldDebitGrams)) g \(House.metal)") }
        if entry.goldCreditGrams > 0 { parts.append("got \(CustomerKit.grams(entry.goldCreditGrams)) g \(House.metal)") }
        if let inv = CustomerKit.filled(entry.linkedInvoiceId) { parts.append("invoice \(inv)") }
        return parts.joined(separator: " · ")
    }

    /// What they owe goes up (+), what they pay comes off (-): debit less credit, as the ERP keeps it.
    private var amount: String? {
        if abs(net) < 1 { return nil }
        return Money.signed(net)
    }

    var body: some View {
        TwoLine(title: CustomerKit.filled(entry.description) ?? "Entry", subtitle: subtitle,
                trailing: amount, trailingTint: net > 0 ? Tone.owed.color : Tone.settled.color)
    }
}

#if os(macOS)

// MARK: - The Mac record window

private enum CustomerMacTab: String, CaseIterable, Identifiable {
    case invoices = "Invoices", orders = "Orders", repairs = "Repairs", hisaab = "Hisaab"
    var id: String { rawValue }
}

/// A customer as a record window (docs/features/mac-design.md, "Customers"): a document header (name, number and city, what
/// they owe), one sortable table filling the window (the toolbar's segmented control picks Invoices, Orders, Repairs or
/// Hisaab), and their details in the inspector at the right. Edit opens the edit form as a sheet. The facts, the writes and
/// the rules are the page's above; the actions are the Customer menu's.
extension CustomerScreen {
    private func macPage(_ f: Facts) -> some View {
        let c = f.customer
        return VStack(spacing: 0) {
            MacDocumentHeader(title: CustomerKit.shown(c), subtitle: macLine(c), headline: macHeadline(f.owing))
            Divider()
            macTable(f)
                .macSummaryBar(macSummary(f))
        }
        .macInspector { macDetails(f) }
        .toolbar { macToolbar(f) }
        .macRecordMenu(MacRecordMenu(title: "Customer", groups: macActionGroups(f)))
        .sheet(isPresented: $macEditing) { macEditSheet(c.id) }
        .navigationDestination(item: $macGo) { (r: Route) in PlaceScreen(path: r.path) }
        .onChange(of: macTab) { _, _ in macPick = [] }
    }

    private var macTabs: [CustomerMacTab] {
        CustomerMacTab.allCases.filter { (t: CustomerMacTab) in t != .hisaab || session.isOwner }
    }

    /// "0300 1234567 · Karachi".
    private func macLine(_ c: Customer) -> String {
        [CustomerKit.filled(c.phone), CustomerKit.filled(c.city)]
            .compactMap { (s: String?) -> String? in s }
            .joined(separator: " \u{00B7} ")
    }

    private func macHeadline(_ o: CustomerKit.Owing) -> MacHeadline? {
        if o.total >= 1 { return MacHeadline("Owed", Money.pkr(o.total), tone: .owed) }
        if o.shopOwesThem >= 1 { return MacHeadline("The hisaab owes them", Money.pkr(o.shopOwesThem), tone: .credit) }
        return nil
    }

    /// A record in a window of its own; in the stack where windows are not offered.
    private func macOpen(_ route: Route) {
        if let openPlace { openPlace(route) } else { macGo = route }
    }

    // MARK: The actions, declared once

    private func macContactActions(_ c: Customer) -> [MacAction] {
        let call = CustomerKit.callURL(c.phone)
        let whatsApp = CustomerKit.whatsAppURL(c.phone)
        let message = CustomerKit.messageURL(c.phone)
        return [
            MacAction("Call", symbol: "phone", enabled: call != nil, id: "call") { if let call { openURL(call) } },
            MacAction("WhatsApp", symbol: "message", enabled: whatsApp != nil, id: "whatsapp") { if let whatsApp { openURL(whatsApp) } },
            MacAction("Message", symbol: "text.bubble", enabled: message != nil, id: "message") { if let message { openURL(message) } },
        ]
    }

    private var macEditAction: MacAction {
        MacAction("Edit\u{2026}", symbol: "pencil", shortcut: KeyboardShortcut("e", modifiers: .command), id: "edit") { macEditing = true }
    }

    private func macHisaabAction(_ c: Customer) -> MacAction {
        MacAction("Open Hisaab", symbol: "book.closed", id: "hisaab") {
            macOpen(Route(path: CustomerKit.hisaabPath(c.id)))
        }
    }

    /// The invoice picked on the Invoices tab, when it holds credit that can be handed back.
    private func macCreditInvoice(_ f: Facts) -> Invoice? {
        guard macTab == .invoices, macPick.count == 1, let id = macPick.first,
              let inv = f.invoices.first(where: { (i: Invoice) in i.id == id }), InvoiceCredit.held(inv) >= 1 else { return nil }
        return inv
    }

    private func macActionGroups(_ f: Facts) -> [[MacAction]] {
        let c = f.customer
        var groups: [[MacAction]] = []
        var contact = macContactActions(c)
        if session.isOwner {
            groups.append([macEditAction])
            contact.append(macHisaabAction(c))
        }
        groups.append(contact)
        if session.isOwner {
            let credit = macCreditInvoice(f)
            groups.append([MacAction("Give Back Credit\u{2026}", symbol: "banknote", enabled: credit != nil, id: "giveback") {
                if let credit { givingBack = credit }
            }])
            groups.append([MacAction("Remove Customer\u{2026}", symbol: "person.badge.minus",
                                     shortcut: KeyboardShortcut(.delete, modifiers: .command),
                                     role: .destructive, id: "remove") { askToRemove(f) }])
        }
        return groups
    }

    @ToolbarContentBuilder
    private func macToolbar(_ f: Facts) -> some ToolbarContent {
        ToolbarItem(placement: .principal) {
            Picker("Show", selection: $macTab) {
                ForEach(macTabs) { (t: CustomerMacTab) in
                    Text(t.rawValue + macCount(t, f)).tag(t)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .help("Invoices, orders, repairs or hisaab")
        }
        // A record window: WhatsApp and Call, the rest under More (the keys are the Customer menu's, not these buttons').
        ToolbarItemGroup(placement: .automatic) {
            MacToolbarAction(action: macContactActions(f.customer)[1])
            MacToolbarAction(action: macContactActions(f.customer)[0])
            Menu {
                ForEach(macMoreActions(f)) { (a: MacAction) in
                    Button(role: a.role, action: a.perform) { Label(a.title, systemImage: a.symbol ?? "circle") }
                        .disabled(!a.enabled)
                }
            } label: {
                Label("More", systemImage: "ellipsis.circle")
            }
            .help("Message, edit or open the hisaab")
        }
    }

    /// Message, and (an owner's) Edit and the hisaab.
    private func macMoreActions(_ f: Facts) -> [MacAction] {
        var out: [MacAction] = [macContactActions(f.customer)[2]]
        if session.isOwner {
            out.append(macEditAction)
            out.append(macHisaabAction(f.customer))
        }
        return out
    }

    private func macCount(_ t: CustomerMacTab, _ f: Facts) -> String {
        let n: Int
        switch t {
        case .invoices: n = f.invoices.count
        case .orders: n = f.orders.count
        case .repairs: n = f.repairs.count
        case .hisaab: n = f.hisaab.count
        }
        return n == 0 ? "" : " (\(n))"
    }

    private func macEditSheet(_ id: String) -> some View {
        NavigationStack {
            EditCustomer(id: id)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { macEditing = false }
                    }
                }
        }
        .frame(minWidth: 560, idealWidth: 720, minHeight: 520, idealHeight: 640)
    }

    // MARK: The table

    @ViewBuilder
    private func macTable(_ f: Facts) -> some View {
        switch macTab {
        case .invoices:
            MacCustomerRecordInvoices(
                invoices: f.invoices, revision: book.invoices.revision, selection: $macPick, owner: session.isOwner,
                open: { (id: String) in macOpen(CustomerKit.place("/invoices/", id)) },
                giveBack: { (inv: Invoice) in givingBack = inv })
        case .orders:
            MacCustomerRecordOrders(
                orders: f.orders, revision: book.orders.revision, selection: $macPick,
                open: { (id: String) in macOpen(CustomerKit.place("/orders/", id)) })
        case .repairs:
            MacCustomerRecordRepairs(
                repairs: f.repairs, revision: book.repairs.revision, selection: $macPick,
                open: { (id: String) in macOpen(CustomerKit.place("/repairs?id=", id)) })
        case .hisaab:
            MacCustomerRecordHisaab(
                rows: f.hisaab, revision: book.hisaab.revision, selection: $macPick,
                openInvoice: { (id: String) in macOpen(Route(path: MoneyPaths.invoice(id))) },
                openHisaab: { macOpen(Route(path: CustomerKit.hisaabPath(f.customer.id))) })
        }
    }

    private func macSummary(_ f: Facts) -> [String] {
        func count(_ n: Int, _ word: String) -> String { "\(n) \(word)\(n == 1 ? "" : "s")" }
        switch macTab {
        case .invoices:
            var parts = [count(f.invoices.count, "invoice")]
            let billed = f.invoices.filter { (i: Invoice) in i.status != .refunded }
                .reduce(0.0) { (sum: Double, i: Invoice) in sum + i.grandTotal }
            if billed > 0 { parts.append("\(Money.pkrLac(billed)) billed") }
            if f.owing.onInvoices >= 1 { parts.append("\(Money.pkr(f.owing.onInvoices)) owed on invoices") }
            if f.owing.inHisaab >= 1 { parts.append("\(Money.pkr(f.owing.inHisaab)) in the hisaab") }
            return parts
        case .orders:
            return [count(f.orders.count, "order")]
        case .repairs:
            var parts = [count(f.repairs.count, "repair")]
            let owed = f.repairs.filter { (r: Repair) in r.status == .received || r.status == .ready }
                .reduce(0.0) { (sum: Double, r: Repair) in sum + CustomerKit.repairBalance(r) }
            if owed >= 1 { parts.append("\(Money.pkr(owed)) owed") }
            return parts
        case .hisaab:
            var parts = [count(f.hisaab.count, "row")]
            if f.owing.inHisaab >= 1 { parts.append("owes \(Money.pkr(f.owing.inHisaab))") }
            if f.owing.shopOwesThem >= 1 { parts.append("the hisaab owes them \(Money.pkr(f.owing.shopOwesThem))") }
            return parts
        }
    }

    // MARK: Their details, at the right

    private func macDetails(_ f: Facts) -> some View {
        let c = f.customer
        return VStack(spacing: 0) {
            if session.isOwner {
                HStack {
                    MacActionButtons(actions: [macEditAction, macHisaabAction(c)])
                    Spacer(minLength: 0)
                }
                .padding(16)
                Divider()
            }
            Form {
                macContact(c)
                macSizes(c)
                macDates(c)
                macNotes(c)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
    }

    @ViewBuilder
    private func macContact(_ c: Customer) -> some View {
        let address = [c.address, c.city, c.country].compactMap { (s: String?) -> String? in CustomerKit.filled(s) }.joined(separator: ", ")
        Section("Contact") {
            if let phone = CustomerKit.filled(c.phone) { LabeledContent("Phone", value: phone) }
            if let alt = CustomerKit.filled(c.altPhone) { LabeledContent("Second number", value: alt) }
            if let email = CustomerKit.filled(c.email) { LabeledContent("Email", value: email) }
            if !address.isEmpty { LabeledContent("Address", value: address) }
            if let source = c.source { LabeledContent("Came from", value: CustomerKit.sourceLabel(source)) }
        }
    }

    @ViewBuilder
    private func macSizes(_ c: Customer) -> some View {
        let ring = CustomerKit.filled(c.ringSize)
        let bangle = CustomerKit.filled(c.bangleSize)
        let bracelet = CustomerKit.filled(c.braceletSize)
        let chain = CustomerKit.filled(c.chainLength)
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
    private func macDates(_ c: Customer) -> some View {
        let birthday = CustomerKit.filled(c.birthday)
        let anniversary = CustomerKit.filled(c.anniversary)
        if birthday != nil || anniversary != nil {
            Section("Dates") {
                if let birthday { LabeledContent("Birthday", value: CustomerKit.day(birthday)) }
                if let anniversary { LabeledContent("Anniversary", value: CustomerKit.day(anniversary)) }
            }
        }
    }

    @ViewBuilder
    private func macNotes(_ c: Customer) -> some View {
        let preference = CustomerKit.filled(c.preference)
        let notes = CustomerKit.filled(c.notes)
        if preference != nil || notes != nil {
            Section("Notes") {
                if let preference {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Prefers").font(.caption).foregroundStyle(.secondary)
                        Text(preference).textSelection(.enabled)
                    }
                }
                if let notes {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Notes").font(.caption).foregroundStyle(.secondary)
                        Text(notes).textSelection(.enabled)
                    }
                }
            }
        }
    }
}
#endif
