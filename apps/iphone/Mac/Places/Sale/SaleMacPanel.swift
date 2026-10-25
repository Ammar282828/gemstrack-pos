#if os(macOS)
import SwiftUI
import ERPCore

// The sale's panel at the right of the New sale / Edit invoice window (docs/features/mac-design.md, "New sale"): 320 pt, a
// grouped form that scrolls on its own. Customer (a combo box, not suggestion rows), Payment, Discount (with Round ▾),
// Exchange, then Rates, Delivery and For the shop as disclosures. Every field writes the same SaleDraft the phone's steps
// write, through the same functions (SaleDraft.pick, changeExchange, payRest, addPayment…); only the controls are a Mac's.

// MARK: Customer

/// What the Name box offers for what is typed: the same people CustomerField offers (the book ranked by
/// `CustomerSearch.rank`, or the last people served before anything is typed), as names for the combo box.
struct SaleMacSuggestions {
    var labels: [String] = []
    var people: [Customer] = []
    /// Customers whose name is exactly what is typed (any case, any spacing).
    var exact: [Customer] = []

    static func make(typed: String, book: [Customer], recent: () -> [Customer]) -> SaleMacSuggestions {
        if typed.isEmpty {
            let people = Array(recent().prefix(4))
            return SaleMacSuggestions(labels: people.map { $0.name }, people: people, exact: [])
        }
        let people = CustomerSearch.rank(typed, in: book, limit: 6).map { $0.customer }
        return SaleMacSuggestions(labels: people.map { $0.name }, people: people, exact: CustomerSearch.exact(typed, in: book))
    }
}

/// The Customer section's rows: the name as a combo box (type to search the book or to name a new customer; its arrow
/// lists the people it found), then the phone. Typing lets go of a customer picked from the book, as the web's box does.
struct SaleMacCustomerRows: View {
    @Binding var draft: SaleDraft
    let book: [Customer]
    /// `book.customers.revision`, and the invoices' and orders' (the last people served): what the suggestions are keyed on.
    let revision: Int
    let recentKey: Int
    let recent: () -> [Customer]
    let pick: (Customer?) -> Void

    @State private var made = Memo<SaleMacSuggestions>()
    @FocusState private var phoneFocused: Bool

    private var nameBinding: Binding<String> {
        Binding(get: { draft.customerName }, set: { draft.typeName($0) })
    }

    var body: some View {
        let typed = draft.customerName.trimmingCharacters(in: .whitespaces)
        let offered = made([revision, recentKey, typed.hashValue]) {
            SaleMacSuggestions.make(typed: typed, book: book, recent: recent)
        }
        LabeledContent("Name") {
            MacComboBox(placeholder: "Search or type a new name", text: nameBinding, items: offered.labels) { index in
                if offered.people.indices.contains(index) { pick(offered.people[index]) }
            }
            .frame(minWidth: 150, maxWidth: .infinity)
        }
        if draft.customerId == nil, offered.exact.count == 1, let c = offered.exact.first {
            HStack(spacing: 8) {
                Label("\(c.name) is on file.", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Button("Use Them") { pick(c) }
                    .controlSize(.small)
                    .help("Put the sale on \(c.name)'s account")
            }
        }
        TextField("Phone", text: $draft.customerPhone, prompt: Text("Optional"))
            .focused($phoneFocused)
            .onSubmit { normalisePhone() }
            .onChange(of: phoneFocused) { old, new in
                if old && !new { normalisePhone() }
            }
    }

    /// The number kept as the ERP keeps it (+92…), as the web's phone box does, once the counter moves on.
    private func normalisePhone() {
        let kept = pakistanE164(draft.customerPhone)
        if kept != draft.customerPhone { draft.customerPhone = kept }
    }
}

// MARK: Exchange fields

/// Which part of an exchange row a field edits.
enum SaleMacExchangeField {
    case description, karat, weightG, ratePerGram, value
}

// MARK: The panel

extension SaleForm {
    /// The panel: one scrolling grouped form. Change rate (the invoice page's "?rates=1") puts Rates on top.
    func macPanel(_ f: SaleFigures, _ ui: SaleMacUI) -> some View {
        Form {
            macEditNote
            if ratesFirst { macRatesSection(f, ui) }
            macCustomerSection(f)
            macPaymentSection(f)
            macDiscountSection(f)
            macExchangeSection()
            if !ratesFirst { macRatesSection(f, ui) }
            macMoreSection(f, ui)
        }
        .formStyle(.grouped)
    }

    /// Edit invoice: what stays and what is added.
    @ViewBuilder
    var macEditNote: some View {
        if let edit {
            Section {
                Label(edit.paidBefore > 0
                      ? "\(Money.pkr(edit.paidBefore)) paid before stays on \(edit.invoiceId). A payment added below is taken now. A piece taken off stays sold."
                      : "Nothing is paid on \(edit.invoiceId) yet. A payment added below is taken now. A piece taken off stays sold.",
                      systemImage: "pencil.and.list.clipboard")
                    .font(.callout)
            }
        }
    }

    // MARK: Customer

    @ViewBuilder
    func macCustomerSection(_ f: SaleFigures) -> some View {
        Section {
            SaleMacCustomerRows(
                draft: $draft,
                book: book.customers.items,
                revision: book.customers.revision,
                recentKey: book.invoices.revision &+ book.orders.revision &* 31,
                recent: { CustomerField.recent(invoices: book.invoices.items, orders: book.orders.items, book: book.customers.items) },
                pick: { pickCustomer($0) })
        } header: {
            Text("Customer")
        } footer: {
            Text(customerNote(f))
        }
    }

    // MARK: Payment

    private func macReferencePrompt(_ method: String) -> String {
        switch method {
        case "Cheque": return "Cheque no."
        case "Card": return "Last 4 digits"
        case "Bank Transfer": return "Reference"
        default: return "No reference"
        }
    }

    @ViewBuilder
    func macPaymentSection(_ f: SaleFigures) -> some View {
        Section {
            ForEach($draft.payments) { $row in
                macPaymentRow($row, f)
            }
            Button { draft.addPayment() } label: { Label("Add Another Payment", systemImage: "plus") }
                .buttonStyle(.borderless)
        } header: {
            Text("Payment received")
        } footer: {
            Text("Taken as the invoice is written and filed in its payment history. Leave it empty if nothing is paid yet: a payment can still be recorded after.")
        }
    }

    @ViewBuilder
    private func macPaymentRow(_ row: Binding<SalePaymentRow>, _ f: SaleFigures) -> some View {
        let single = draft.payments.count < 2
        LabeledContent("Amount") {
            HStack(spacing: 8) {
                TextField("Amount", text: row.amount.wholeRupees, prompt: Text("0"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(minWidth: 70, maxWidth: 110)
                Button(single ? "Paid in Full" : "The Rest") { draft.payRest(row.wrappedValue.id, total: f.total) }
                    .controlSize(.small)
                    .disabled(!f.hasEstimate)
            }
        }
        Picker("Paid by", selection: row.method) {
            ForEach(PaymentMethods.all, id: \.self) { m in Text(m).tag(m) }
        }
        .pickerStyle(.menu)
        if row.wrappedValue.method != "Cash" {
            TextField(macReferencePrompt(row.wrappedValue.method), text: row.reference)
        }
        if !single {
            Button(role: .destructive) { draft.removePayment(row.wrappedValue.id) } label: {
                Label("Remove Payment", systemImage: "minus.circle")
            }
            .buttonStyle(.borderless)
        }
    }

    // MARK: Discount

    @ViewBuilder
    func macDiscountSection(_ f: SaleFigures) -> some View {
        Section {
            LabeledContent("Amount (PKR)") {
                HStack(spacing: 8) {
                    TextField("Amount", text: $draft.discount.wholeRupees, prompt: Text("0"))
                        .labelsHidden()
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                        .frame(minWidth: 70, maxWidth: 110)
                    // Offered once the bill can be worked out; the bill before any discount is the pieces less the exchange.
                    if f.hasEstimate {
                        SaleMacRoundMenu(payable: f.subtotal - f.exchange, discount: f.discount) { n in
                            draft.discount = n > 0 ? String(Int(n)) : ""
                        }
                    }
                }
            }
        } header: {
            Text("Discount")
        } footer: {
            if let problem = f.discountProblem { Text(problem).foregroundStyle(Tone.problem.color) }
        }
    }

    // MARK: Exchange

    private func macExchangePatch(_ field: SaleMacExchangeField, _ text: String) -> ExchangeRowPatch {
        switch field {
        case .description: return ExchangeRowPatch(description: text)
        case .karat: return ExchangeRowPatch(karat: text)
        case .weightG: return ExchangeRowPatch(weightG: text)
        case .ratePerGram: return ExchangeRowPatch(ratePerGram: text)
        case .value: return ExchangeRowPatch(value: text)
        }
    }

    private func macExchangeText(_ row: SaleExchangeRow, _ field: SaleMacExchangeField) -> String {
        switch field {
        case .description: return row.description
        case .karat: return row.karat
        case .weightG: return row.weightG
        case .ratePerGram: return row.ratePerGram
        case .value: return row.value
        }
    }

    /// A row's field, edited through ERPCore's `applyExchangeRowChange`: grams × rate refills the amount until one is typed.
    private func macExchange(_ id: String, _ field: SaleMacExchangeField) -> Binding<String> {
        Binding(
            get: {
                guard let row = draft.exchanges.first(where: { $0.id == id }) else { return "" }
                return macExchangeText(row, field)
            },
            set: { text in draft.changeExchange(id, macExchangePatch(field, text)) }
        )
    }

    @ViewBuilder
    func macExchangeSection() -> some View {
        let total = exchangeRowsTotal(draft.exchanges.map { $0.core })
        Section {
            ForEach(draft.exchanges) { row in
                macExchangeRow(row)
            }
            Button { draft.addExchange() } label: { Label("Add Another Exchange", systemImage: "plus") }
                .buttonStyle(.borderless)
            if draft.exchanges.count > 1 && total > 0 {
                LabeledContent("Exchange total") { Text(Money.pkr(total)).monospacedDigit() }
            }
        } header: {
            Text("Exchange / trade-in")
        }
    }

    @ViewBuilder
    private func macExchangeRow(_ row: SaleExchangeRow) -> some View {
        TextField("What it is", text: macExchange(row.id, .description), prompt: Text("e.g. old ring"))
        LabeledContent("Amount") {
            TextField("Amount", text: macExchange(row.id, .value).wholeRupees, prompt: Text("0"))
                .labelsHidden()
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .frame(minWidth: 70, maxWidth: 110)
        }
        if row.hasDetails || openedExchange.contains(row.id) {
            macExchangeDetails(row)
        } else {
            Button("Add Weight and Rate") { openedExchange.insert(row.id) }
                .buttonStyle(.borderless)
        }
        if draft.exchanges.count > 1 {
            Button(role: .destructive) { draft.removeExchange(row.id) } label: {
                Label("Remove Exchange", systemImage: "minus.circle")
            }
            .buttonStyle(.borderless)
        }
    }

    @ViewBuilder
    private func macExchangeDetails(_ row: SaleExchangeRow) -> some View {
        let computed = !row.valueTyped && SaleNumber.value(row.weightG) > 0 && SaleNumber.value(row.ratePerGram) > 0
        // Karat only where the house sells gold; a silver house weighs without it.
        if House.metal == "gold" {
            Picker("Karat", selection: macExchange(row.id, .karat)) {
                Text("Not set").tag("")
                ForEach(["24k", "22k", "21k", "18k"], id: \.self) { k in Text(k).tag(k) }
            }
            .pickerStyle(.menu)
        }
        TextField("Grams", text: macExchange(row.id, .weightG), prompt: Text("0"))
            .multilineTextAlignment(.trailing)
        TextField("Rate / g", text: macExchange(row.id, .ratePerGram), prompt: Text("0"))
            .multilineTextAlignment(.trailing)
        if computed {
            Text("Amount = grams × rate. Type an amount to change it.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Rates

    /// The words for a rate that was not set today (RateKeys is the rate sheet's own).
    private var macStaleRateText: String {
        let s: Settings? = book.settings.value
        let main: Double = s?[keyPath: RateKeys.main.value] ?? 0
        return "The rate was not set today (\(RateKeys.main.label) \(Money.grouped(main)) · \(RateKeys.whenSet(s?.ratesUpdatedAt))). Click to set it, or carry on."
    }

    /// The rates this bill uses, typed for this sale only. The shop's rate not set today is said, never a block.
    @ViewBuilder
    func macRatesSection(_ f: SaleFigures, _ ui: SaleMacUI) -> some View {
        let stale = f.hasPieces && !RateKeys.setToday(book.settings.value)
        if !f.boxes.isEmpty || stale {
            Section {
                if stale {
                    Button { rateSheet = true } label: {
                        Label(macStaleRateText, systemImage: "exclamationmark.triangle.fill")
                            .font(.callout)
                            .foregroundStyle(Tone.owed.color)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                }
                if !f.boxes.isEmpty {
                    // Open while a gold rate is missing: Save waits for it, and the footer says so.
                    DisclosureGroup("Rates (PKR per gram)", isExpanded: Binding(
                        get: { ui.ratesOpen || !f.missingRates.isEmpty },
                        set: { ui.ratesOpen = $0 })) {
                        ForEach(f.boxes) { box in
                            LabeledContent(box.label) {
                                TextField("Rate", text: rateBinding(box.key), prompt: Text("0"))
                                    .labelsHidden()
                                    .multilineTextAlignment(.trailing)
                                    .monospacedDigit()
                                    .frame(minWidth: 70, maxWidth: 110)
                            }
                        }
                        if !draft.rates.isEmpty {
                            Button("Back to Today's Rates") { draft.rates = [:] }
                                .buttonStyle(.borderless)
                        }
                        Text("Used for this sale only. A rate typed here is not saved as today's rate: set that from the rate in the toolbar.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    // MARK: Delivery and For the shop

    @ViewBuilder
    func macMoreSection(_ f: SaleFigures, _ ui: SaleMacUI) -> some View {
        Section {
            DisclosureGroup("Delivery", isExpanded: Bindable(ui).deliveryOpen) {
                macDeliveryRows(f)
            }
            DisclosureGroup("For the shop", isExpanded: Bindable(ui).shopOpen) {
                macShopRows(f)
            }
        }
    }

    @ViewBuilder
    private func macDeliveryRows(_ f: SaleFigures) -> some View {
        Toggle("Deliver this", isOn: $draft.delivery.required)
        if draft.delivery.required {
            let known = SaleLookup.knownAddresses(
                customerId: f.who.id,
                customerAddress: book.customers.item(f.who.id ?? "")?.address,
                invoices: book.invoices.items
            )
            if !known.isEmpty {
                Menu("Address on file") {
                    ForEach(known, id: \.self) { a in Button(a) { draft.delivery.address = a } }
                }
            }
            TextField("Delivery address", text: $draft.delivery.address, prompt: Text("House / flat, street, area"), axis: .vertical)
                .lineLimit(2...4)
            TextField("City", text: $draft.delivery.city, prompt: Text("Karachi"))
            Toggle("Expected date", isOn: hasExpectedDate)
            if !draft.delivery.expectedDate.isEmpty {
                DatePicker("Date", selection: expectedDateBinding, displayedComponents: .date)
                    .datePickerStyle(.field)
            }
            TextField("Receiver name", text: $draft.delivery.contactName, prompt: Text("If not the customer"))
            TextField("Receiver phone", text: $draft.delivery.contactPhone, prompt: Text("Optional"))
            SaleNumberField(label: "Delivery charge (PKR)", text: $draft.delivery.charge, prompt: "0 if free", rupees: true)
            TextField("Instructions", text: $draft.delivery.notes, prompt: Text("Landmark, timing, gate code"))
        }
    }

    @ViewBuilder
    private func macShopRows(_ f: SaleFigures) -> some View {
        takenByRow
        Toggle(isOn: $draft.hideRates) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Leave rates off the printed bill")
                Text("Prices stay the same. The invoice just won't show the per-gram rate.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        TextField("Internal note", text: $draft.internalNote,
                  prompt: Text("Changes still to make, promises given, anything to remember about this sale"), axis: .vertical)
            .lineLimit(2...6)
        // Houses that cost a sale by its gold ask for the 24k rate now (lib/margin.ts); Mina's silver does not.
        if House.margin.rattiLess != nil { costRateRows(f) }
        Text("Never printed on the bill or sent to the customer.")
            .font(.caption)
            .foregroundStyle(.secondary)
    }
}
#endif
