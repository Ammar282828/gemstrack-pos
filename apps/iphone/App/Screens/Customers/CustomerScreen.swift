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
        VStack(spacing: 14) {
            VStack(spacing: 8) {
                Monogram(name: CustomerKit.shown(c), size: 56)
                Text(CustomerKit.shown(c))
                    .font(.system(.title2, design: .serif).weight(.semibold))
                    .multilineTextAlignment(.center)
                if let phone = CustomerKit.filled(c.phone) {
                    Text(phone).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            HStack(spacing: 10) {
                contact("Call", "phone.fill", CustomerKit.callURL(c.phone))
                contact("WhatsApp", "message.fill", CustomerKit.whatsAppURL(c.phone))
                contact("Message", "text.bubble.fill", CustomerKit.messageURL(c.phone))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }

    private func contact(_ title: String, _ symbol: String, _ url: URL?) -> some View {
        Button {
            if let url { openURL(url) }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.title3)
                Text(title).font(.caption)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .disabled(url == nil)
    }

    // MARK: Owed

    @ViewBuilder private func owedSection(_ o: CustomerKit.Owing) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
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
        HStack(spacing: 8) {
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
        HStack(spacing: 8) {
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

/// A customer as a record window: who they are, what they owe, their details and sizes in a column on the left; their
/// invoices, orders, repairs and hisaab as tabs of tables on the right, each row with a right-click menu and a
/// double-click that opens it in a window of its own. The facts, the writes and the rules are the page's above.
extension CustomerScreen {
    private func macPage(_ f: Facts) -> some View {
        HSplitView {
            macSide(f)
                .frame(minWidth: 300, idealWidth: 340, maxWidth: 460)
            macTabs(f)
                .frame(minWidth: 480)
        }
        .background(Theme.ground)
        .navigationSubtitle(f.owing.total >= 1 ? "Owes \(Money.pkr(f.owing.total))" : "")
        .navigationDestination(item: $macGo) { (r: Route) in PlaceScreen(path: r.path) }
        .toolbar { macToolbar(f) }
    }

    @ToolbarContentBuilder
    private func macToolbar(_ f: Facts) -> some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            if let url = CustomerKit.whatsAppURL(f.customer.phone) {
                Button { openURL(url) } label: { Label("WhatsApp", systemImage: "message") }
                    .help("Message them on WhatsApp")
            }
            if let url = CustomerKit.callURL(f.customer.phone) {
                Button { openURL(url) } label: { Label("Call", systemImage: "phone") }
                    .help("Call them")
            }
            if let url = CustomerKit.messageURL(f.customer.phone) {
                Button { openURL(url) } label: { Label("Message", systemImage: "text.bubble") }
                    .help("Send a text message")
            }
            if session.isOwner {
                Menu {
                    Button { macGo = Route(path: CustomerKit.hisaabPath(f.customer.id)) } label: {
                        Label("Open their hisaab", systemImage: "book.closed")
                    }
                    Divider()
                    Button(role: .destructive) { askToRemove(f) } label: {
                        Label("Remove this customer", systemImage: "person.badge.minus")
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .help("More about this customer")
            }
        }
    }

    // MARK: The column on the left

    private func macSide(_ f: Facts) -> some View {
        let c = f.customer
        let address = [c.address, c.city, c.country].compactMap { CustomerKit.filled($0) }.joined(separator: ", ")
        let owed = macOwedDetail(f.owing)
        return Form {
            Section {
                VStack(spacing: 8) {
                    Monogram(name: CustomerKit.shown(c), size: 64)
                    Text(CustomerKit.shown(c))
                        .font(.system(.title2, design: .serif).weight(.semibold))
                        .multilineTextAlignment(.center)
                        .textSelection(.enabled)
                    if let phone = CustomerKit.filled(c.phone) {
                        Text(phone).font(.subheadline).foregroundStyle(.secondary).monospacedDigit().textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            Section("Owed to you") {
                HeroAmount(amount: f.owing.total)
                if !owed.isEmpty {
                    Text(owed).font(.footnote).foregroundStyle(.secondary)
                }
            }
            Section("Customer details") {
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
            macSizes(c)
            if session.isOwner {
                Section {
                    Button(role: .destructive) { askToRemove(f) } label: {
                        Label("Remove this customer", systemImage: "person.badge.minus")
                    }
                } footer: {
                    Text("Removing hides them; their invoices, orders and hisaab stay, and Settings, then Recently removed, puts them back. It asks for the delete code.")
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
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

    private func macOwedDetail(_ o: CustomerKit.Owing) -> String {
        var parts: [String] = []
        if o.onInvoices >= 1 {
            parts.append("On \(o.invoiceCount) invoice\(o.invoiceCount == 1 ? "" : "s") \(Money.pkr(o.onInvoices))")
        }
        if o.inHisaab >= 1 { parts.append("In the hisaab \(Money.pkr(o.inHisaab))") }
        if o.shopOwesThem >= 1 { parts.append("The hisaab owes them \(Money.pkr(o.shopOwesThem))") }
        return parts.joined(separator: " \u{00B7} ")
    }

    // MARK: The tabs of tables

    private func macTabs(_ f: Facts) -> some View {
        let tabs = CustomerMacTab.allCases.filter { $0 != .hisaab || session.isOwner }
        return VStack(spacing: 0) {
            HStack {
                Picker("Show", selection: $macTab) {
                    ForEach(tabs) { (t: CustomerMacTab) in
                        Text("\(t.rawValue) \(macCount(t, f))").tag(t)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 460)
                Spacer(minLength: 0)
            }
            .padding(12)
            Divider()
            Group {
                switch macTab {
                case .invoices: macInvoices(f.invoices)
                case .orders: macOrders(f.orders)
                case .repairs: macRepairs(f.repairs)
                case .hisaab: macHisaab(f.hisaab, id: f.customer.id)
                }
            }
            .onChange(of: macTab) { _, _ in macPick = [] }
        }
    }

    private func macCount(_ t: CustomerMacTab, _ f: Facts) -> String {
        let n: Int
        switch t {
        case .invoices: n = f.invoices.count
        case .orders: n = f.orders.count
        case .repairs: n = f.repairs.count
        case .hisaab: n = f.hisaab.count
        }
        return n == 0 ? "" : "(\(n))"
    }

    private func macRoute(_ t: CustomerMacTab, _ id: String) -> Route {
        switch t {
        case .invoices: return CustomerKit.place("/invoices/", id)
        case .orders: return CustomerKit.place("/orders/", id)
        case .repairs: return CustomerKit.place("/repairs?id=", id)
        case .hisaab: return Route(path: MoneyPaths.invoice(id))
        }
    }

    /// A row's right-click menu: open it here or in a window of its own, copy its number, and (an invoice in credit) give it back.
    @ViewBuilder
    private func macRowMenu(_ t: CustomerMacTab, _ ids: Set<String>, invoices: [Invoice] = []) -> some View {
        if let id = ids.first {
            Button("Open") { macGo = macRoute(t, id) }
            Button("Open in New Window") { openPlace?(macRoute(t, id)) }
            if t == .invoices, session.isOwner, let inv = invoices.first(where: { $0.id == id }), InvoiceCredit.held(inv) >= 1 {
                Divider()
                Button("Give back \(Money.pkr(InvoiceCredit.held(inv)))") { givingBack = inv }
            }
            Divider()
            Button("Copy number") { UIPasteboard.general.string = ids.sorted().joined(separator: "\n") }
        }
    }

    private func macEmpty(_ text: String, _ symbol: String) -> some View {
        ContentUnavailableView(text, systemImage: symbol)
    }

    private func macInvoices(_ list: [Invoice]) -> some View {
        Table(list, selection: $macPick) {
            TableColumn("Invoice") { (inv: Invoice) in Text(inv.id).monospacedDigit() }.width(min: 90, ideal: 120)
            TableColumn("Date") { (inv: Invoice) in Text(ShopDate.say(inv.createdAt)) }.width(min: 80, ideal: 100)
            TableColumn("Total") { (inv: Invoice) in Text(Money.pkr(inv.grandTotal)).monospacedDigit() }.width(min: 90, ideal: 110)
            TableColumn("Owed") { (inv: Invoice) in
                // Only what needs someone is coloured: a settled or refunded bill shows nothing here.
                let line = balanceLine(inv.balanceDue)
                Text(inv.status != .refunded && line.state == .due ? Money.pkr(line.amount) : "")
                    .monospacedDigit().foregroundStyle(Tone.owed.color)
            }.width(min: 90, ideal: 110)
            TableColumn("Credit") { (inv: Invoice) in
                let held = InvoiceCredit.held(inv)
                Text(held >= 1 ? Money.pkr(held) : "").monospacedDigit().foregroundStyle(Tone.credit.color)
            }.width(min: 90, ideal: 110)
            TableColumn("Status") { (inv: Invoice) in
                Text(inv.status == .refunded ? "Refunded" : "").foregroundStyle(.secondary)
            }.width(min: 70, ideal: 90)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            macRowMenu(.invoices, ids, invoices: list)
        } primaryAction: { ids in
            for id in ids.prefix(5) { openPlace?(macRoute(.invoices, id)) }
        }
        .overlay { if list.isEmpty { macEmpty("No sales history found for this customer", "doc.text") } }
    }

    private func macOrders(_ list: [Order]) -> some View {
        Table(list, selection: $macPick) {
            TableColumn("Order") { (o: Order) in Text(o.id).monospacedDigit() }.width(min: 90, ideal: 120)
            TableColumn("Taken") { (o: Order) in Text(ShopDate.say(o.createdAt)) }.width(min: 80, ideal: 100)
            TableColumn("Pieces") { (o: Order) in Text("\(o.items.count)").monospacedDigit() }.width(60)
            TableColumn("Status") { (o: Order) in
                // Completed is the expected end: no badge for it.
                if o.status != .completed { StatusBadge(order: o.status) }
            }.width(min: 90, ideal: 120)
            TableColumn("Still to pay") { (o: Order) in
                let closed = o.status == .cancelled || o.status == .refunded || !(o.invoiceId ?? "").isEmpty
                Text(Money.pkr(o.grandTotal)).monospacedDigit().foregroundStyle(closed ? Color.secondary : Color.primary)
            }.width(min: 90, ideal: 110)
            TableColumn("Invoice") { (o: Order) in Text(o.invoiceId ?? "").monospacedDigit().foregroundStyle(.secondary) }
                .width(min: 80, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            macRowMenu(.orders, ids)
        } primaryAction: { ids in
            for id in ids.prefix(5) { openPlace?(macRoute(.orders, id)) }
        }
        .overlay { if list.isEmpty { macEmpty("No orders", "shippingbox") } }
    }

    private func macRepairs(_ list: [Repair]) -> some View {
        Table(list, selection: $macPick) {
            TableColumn("Repair") { (r: Repair) in Text(CustomerKit.repairSummary(r)) }.width(min: 140, ideal: 220)
            TableColumn("Ticket") { (r: Repair) in Text(r.id).monospacedDigit() }.width(min: 80, ideal: 100)
            TableColumn("Received") { (r: Repair) in Text(ShopDate.say(r.receivedAt)) }.width(min: 80, ideal: 100)
            TableColumn("Promised") { (r: Repair) in
                let open = r.status == .received || r.status == .ready
                Text(open ? ShopDate.say(CustomerKit.filled(r.promisedDate) ?? "") : "")
            }.width(min: 80, ideal: 100)
            TableColumn("Status") { (r: Repair) in
                let s = CustomerKit.repairStatus(r.status)
                // Collected is the expected end: no pill for it.
                if r.status != .collected { Pill(s.text, tone: s.tone) }
            }.width(min: 90, ideal: 110)
            TableColumn("Owed") { (r: Repair) in
                let open = r.status == .received || r.status == .ready
                let balance = CustomerKit.repairBalance(r)
                Text(open && balance >= 1 ? Money.pkr(balance) : "").monospacedDigit().foregroundStyle(Tone.owed.color)
            }.width(min: 90, ideal: 110)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            macRowMenu(.repairs, ids)
        } primaryAction: { ids in
            for id in ids.prefix(5) { openPlace?(macRoute(.repairs, id)) }
        }
        .overlay { if list.isEmpty { macEmpty("No repairs", "wrench.and.screwdriver") } }
    }

    private func macHisaab(_ rows: [HisaabEntry], id: String) -> some View {
        Table(rows, selection: $macPick) {
            TableColumn("Date") { (e: HisaabEntry) in Text(ShopDate.say(e.date)) }.width(min: 80, ideal: 100)
            TableColumn("Entry") { (e: HisaabEntry) in
                let metal: String = {
                    var parts: [String] = []
                    if e.goldDebitGrams > 0 { parts.append("gave \(CustomerKit.grams(e.goldDebitGrams)) g \(House.metal)") }
                    if e.goldCreditGrams > 0 { parts.append("got \(CustomerKit.grams(e.goldCreditGrams)) g \(House.metal)") }
                    return parts.joined(separator: " \u{00B7} ")
                }()
                VStack(alignment: .leading, spacing: 1) {
                    Text(CustomerKit.filled(e.description) ?? "Entry")
                    if !metal.isEmpty { Text(metal).font(.caption).foregroundStyle(.secondary) }
                }
            }
            TableColumn("You gave") { (e: HisaabEntry) in
                Text(e.cashDebit > 0 ? Money.pkr(e.cashDebit) : "").monospacedDigit().foregroundStyle(Tone.owed.color)
            }.width(min: 90, ideal: 110)
            TableColumn("You got") { (e: HisaabEntry) in
                Text(e.cashCredit > 0 ? Money.pkr(e.cashCredit) : "").monospacedDigit().foregroundStyle(Tone.settled.color)
            }.width(min: 90, ideal: 110)
            TableColumn("Invoice") { (e: HisaabEntry) in
                Text(CustomerKit.filled(e.linkedInvoiceId) ?? "").monospacedDigit().foregroundStyle(.secondary)
            }.width(min: 80, ideal: 100)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let eid = ids.first, let inv = rows.first(where: { $0.id == eid })?.linkedInvoiceId, !inv.isEmpty {
                Button("Open invoice") { macGo = macRoute(.hisaab, inv) }
                Button("Open invoice in New Window") { openPlace?(macRoute(.hisaab, inv)) }
            }
            Button("Open their hisaab") { macGo = Route(path: CustomerKit.hisaabPath(id)) }
            Button("Open their hisaab in New Window") { openPlace?(Route(path: CustomerKit.hisaabPath(id))) }
        } primaryAction: { ids in
            if let eid = ids.first, let inv = rows.first(where: { $0.id == eid })?.linkedInvoiceId, !inv.isEmpty {
                openPlace?(macRoute(.hisaab, inv))
            }
        }
        .overlay { if rows.isEmpty { macEmpty("Nothing in their hisaab", "book.closed") } }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                Divider()
                HStack {
                    Spacer()
                    Button { macGo = Route(path: CustomerKit.hisaabPath(id)) } label: {
                        Label("Open their hisaab", systemImage: "book.closed")
                    }
                }
                .padding(10)
            }
            .background(.bar)
        }
    }
}
#endif
