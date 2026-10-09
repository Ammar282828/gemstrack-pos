import SwiftUI
import ERPCore

// The sections of New sale, in the order of the web's page (sale-page.tsx): the customer, the
// pieces, the rates, the discount, what is handed over in exchange, what is paid now, the shop's own
// fields, the delivery, and the totals.

@MainActor
extension SaleForm {
    // MARK: 1. Customer

    var nameBinding: Binding<String> {
        // Typing a name lets go of a customer picked from the book, as the web's name box does.
        Binding(
            get: { draft.customerName },
            set: { text in draft.typeName(text) }
        )
    }

    func customerNote(_ f: SaleFigures) -> String {
        if draft.customerId != nil { return "\(f.who.name) is on file: the sale goes on their account." }
        if f.who.id != nil { return "That number is on file as \(f.who.name): the sale goes to them." }
        if f.namedCustomer { return "\(f.who.name) is new: the ERP adds them to the book when the sale is saved." }
        return "Nobody named: a walk-in. No customer is made, and money paid over the total can't be kept as credit."
    }

    @ViewBuilder
    func customerSection(_ f: SaleFigures) -> some View {
        Section {
            Button { pickingCustomer = true } label: {
                Label("Pick from the book", systemImage: "person.crop.circle.badge.checkmark")
            }
            TextField("Name", text: nameBinding, prompt: Text("Type the customer's name"))
                .textContentType(.name)
                .textInputAutocapitalization(.words)
            TextField("Contact number", text: $draft.customerPhone, prompt: Text("Optional"))
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
            if draft.customerId != nil || !draft.customerName.isEmpty || !draft.customerPhone.isEmpty {
                Button("Make it a walk-in", role: .destructive) { pickCustomer(nil) }
            }
        } header: {
            Text("Customer")
        } footer: {
            Text(customerNote(f))
        }
    }

    // MARK: 2. Pieces

    func spec(_ line: SaleLine) -> String {
        var parts: [String] = [describeMetal(line.metalType, line.karat)]
        if line.metalWeightG > 0 { parts.append(SaleNumber.grams(line.metalWeightG) + "g") }
        if let size = line.size, !size.isEmpty { parts.append("Size \(size)") }
        // A key made up for one bill is not a stock number (lib/sku.ts stockSku).
        if let stock = line.stockSku { parts.append(stock) }
        return parts.joined(separator: " · ")
    }

    func lineRow(_ line: SaleLine, _ f: SaleFigures) -> some View {
        // A piece gone from the shelf since it went on the sale (sold at the counter, or on another phone).
        let gone = book.products.loaded && !line.isOneOff && book.products.item(line.sku) == nil
        return VStack(alignment: .leading, spacing: 4) {
            TwoLine(title: line.name.isEmpty ? (line.stockSku ?? "New piece") : line.name, subtitle: spec(line), trailing: Money.pkr(f.price(of: line.sku)))
            if line.isCustomPrice {
                Text("Fixed price: \(Money.pkr(line.customPrice ?? 0))").font(.caption).foregroundStyle(.orange)
            }
            if line.metalType == "silver", !line.isCustomPrice, let rate = line.silverRatePerGram, rate > 0 {
                Text("Rate: \(SaleNumber.grams(rate))/g").font(.caption).foregroundStyle(.blue)
            }
            if gone {
                Label("No longer in stock", systemImage: "exclamationmark.triangle.fill").font(.caption).foregroundStyle(.orange)
            }
        }
        .contentShape(.rect)
    }

    func lineButton(_ line: SaleLine, _ f: SaleFigures) -> some View {
        Button { editing = line } label: { lineRow(line, f) }
            .buttonStyle(.plain)
            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                Button(role: .destructive) { remove(line.sku) } label: { Label("Remove", systemImage: "trash") }
            }
    }

    func resultRow(_ p: Product, _ f: SaleFigures) -> some View {
        let price = calculateProductCosts(PricedPiece(p), f.rateBook.pricing).totalPrice
        return Button { add(p) } label: {
            TwoLine(title: p.name, subtitle: p.sku, trailing: Money.pkr(price)).contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    func piecesSection(_ f: SaleFigures) -> some View {
        let taken = Set(draft.lines.map { $0.sku })
        let results = SaleLookup.matches(query, in: book.products.items, excluding: taken)
        Section {
            if draft.lines.isEmpty {
                Text("Search stock below, scan a tag, or describe a new item.").foregroundStyle(.secondary)
            }
            ForEach(draft.lines) { line in lineButton(line, f) }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search stock by SKU or name", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { addTyped() }
            }
            ForEach(results) { p in resultRow(p, f) }
            if let notice {
                Label(notice, systemImage: "exclamationmark.circle").font(.footnote).foregroundStyle(.orange)
            }
            Button { scanning = true } label: { Label("Scan a tag", systemImage: "qrcode.viewfinder") }
            Button { startNewItem() } label: {
                Label("New item", systemImage: "plus.circle")
            }
            NavigationLink(value: SaleLinks.newPiece) {
                Label("New item, and keep it in stock", systemImage: "square.and.pencil")
            }
            NavigationLink(value: SaleLinks.webBill) {
                Label("Read a written bill", systemImage: "camera.viewfinder")
            }
        } header: {
            Text("Pieces")
        } footer: {
            let n = draft.lines.count
            Text("\(n) piece\(n == 1 ? "" : "s") on this bill. Tap a piece to edit it; swipe to remove it. New item bills a piece that was never in stock, for this sale only. Putting a piece in stock and reading a written bill open the ERP's own pages.")
        }
    }

    // MARK: 3. Rates

    func rateBinding(_ key: RateInputKey) -> Binding<String> {
        Binding(
            get: { SaleRateBook(settings: book.settings.value, typed: draft.rates).text(key) },
            set: { draft.rates[key.rawValue] = $0 }
        )
    }

    var staleRateText: String {
        let s: Settings? = book.settings.value
        let main: Double = s?[keyPath: RateKeys.main.value] ?? 0
        return "The rate was not set today (\(RateKeys.main.label) \(Money.grouped(main)) · \(RateKeys.whenSet(s?.ratesUpdatedAt))). Tap to set it, or carry on."
    }

    @ViewBuilder
    func ratesSection(_ f: SaleFigures) -> some View {
        // The shop's rate not set today: say so, never block the sale (RateStaleNotice).
        let stale = f.hasPieces && !RateKeys.setToday(book.settings.value)
        if !f.boxes.isEmpty || stale {
            Section {
                if stale {
                    Button { rateSheet = true } label: {
                        Label(staleRateText, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }
                ForEach(f.boxes) { box in
                    LabeledContent(box.label) {
                        TextField("0", text: rateBinding(box.key))
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                    }
                }
                if !draft.rates.isEmpty {
                    Button("Back to today's rates") { draft.rates = [:] }
                }
            } header: {
                Text("Rates (PKR per gram)")
            } footer: {
                Text("Used for this sale only. A rate typed here is not saved as today's rate: set that from the rate chip.")
            }
        }
    }

    // MARK: 4. Discount

    @ViewBuilder
    func discountSection(_ f: SaleFigures) -> some View {
        Section {
            SaleNumberField(label: "Amount (PKR)", text: $draft.discount)
        } header: {
            Text("Discount")
        } footer: {
            if let problem = f.discountProblem { Text(problem).foregroundStyle(.red) }
        }
    }

    // MARK: 5. Exchange

    private enum ExchangeField { case description, karat, weightG, ratePerGram, value }

    private func exchangePatch(_ field: ExchangeField, _ text: String) -> ExchangeRowPatch {
        switch field {
        case .description: return ExchangeRowPatch(description: text)
        case .karat: return ExchangeRowPatch(karat: text)
        case .weightG: return ExchangeRowPatch(weightG: text)
        case .ratePerGram: return ExchangeRowPatch(ratePerGram: text)
        case .value: return ExchangeRowPatch(value: text)
        }
    }

    private func exchangeText(_ row: SaleExchangeRow, _ field: ExchangeField) -> String {
        switch field {
        case .description: return row.description
        case .karat: return row.karat
        case .weightG: return row.weightG
        case .ratePerGram: return row.ratePerGram
        case .value: return row.value
        }
    }

    /// A row's field, edited through ERPCore's `applyExchangeRowChange`: grams × rate refills the
    /// amount until someone types one.
    private func exchangeBinding(_ id: String, _ field: ExchangeField) -> Binding<String> {
        Binding(
            get: {
                guard let row = draft.exchanges.first(where: { $0.id == id }) else { return "" }
                return exchangeText(row, field)
            },
            set: { text in draft.changeExchange(id, exchangePatch(field, text)) }
        )
    }

    private func exchangeRow(_ row: SaleExchangeRow) -> some View {
        let computed = !row.valueTyped && SaleNumber.value(row.weightG) > 0 && SaleNumber.value(row.ratePerGram) > 0
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TextField("What it is (e.g. old ring)", text: exchangeBinding(row.id, .description))
                TextField("Amount", text: exchangeBinding(row.id, .value))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(width: 110)
            }
            if row.hasDetails || openedExchange.contains(row.id) {
                HStack(spacing: 10) {
                    // Karat only where the house sells gold; a silver house weighs without it.
                    if House.metal == "gold" {
                        Picker("Karat", selection: exchangeBinding(row.id, .karat)) {
                            Text("Karat").tag("")
                            ForEach(["24k", "22k", "21k", "18k"], id: \.self) { k in Text(k).tag(k) }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                    }
                    TextField("Grams", text: exchangeBinding(row.id, .weightG))
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                    TextField("Rate / g", text: exchangeBinding(row.id, .ratePerGram))
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                }
                if computed {
                    Text("Amount = grams × rate. Type an amount to change it.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Button("+ Weight & rate") { openedExchange.insert(row.id) }
                    .font(.caption)
                    .buttonStyle(.borderless)
            }
        }
    }

    @ViewBuilder
    func exchangeSection() -> some View {
        let total = exchangeRowsTotal(draft.exchanges.map { $0.core })
        Section {
            ForEach(draft.exchanges) { row in
                exchangeRow(row)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) { draft.removeExchange(row.id) } label: { Label("Remove", systemImage: "trash") }
                    }
            }
            Button { draft.addExchange() } label: {
                Label("Add another exchange", systemImage: "plus")
            }
            if draft.exchanges.count > 1 && total > 0 {
                LabeledContent("Exchange total") { Text(Money.pkr(total)).monospacedDigit() }
            }
        } header: {
            Text("Exchange / trade-in")
        } footer: {
            Text("Gold or anything else the customer hands over, taken off the bill at an agreed value.")
        }
    }

    // MARK: 6. Payments taken now

    private func referencePrompt(_ method: String) -> String {
        switch method {
        case "Cheque": return "Cheque no."
        case "Card": return "Last 4 digits"
        case "Bank Transfer": return "Reference"
        default: return "No reference"
        }
    }

    private func paymentRow(_ row: Binding<SalePaymentRow>, _ f: SaleFigures) -> some View {
        let single = draft.payments.count < 2
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TextField("Amount (PKR)", text: row.amount)
                    .keyboardType(.numberPad)
                    .monospacedDigit()
                Button(single ? "Paid in full" : "The rest") { draft.payRest(row.wrappedValue.id, total: f.total) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(!f.hasEstimate)
            }
            HStack(spacing: 10) {
                Picker("Paid by", selection: row.method) {
                    ForEach(PaymentMethods.all, id: \.self) { m in Text(m).tag(m) }
                }
                .pickerStyle(.menu)
                TextField(referencePrompt(row.wrappedValue.method), text: row.reference)
                    .multilineTextAlignment(.trailing)
                    .disabled(row.wrappedValue.method == "Cash")
            }
        }
    }

    @ViewBuilder
    func paymentSection(_ f: SaleFigures) -> some View {
        Section {
            ForEach($draft.payments) { $row in
                paymentRow($row, f)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) { draft.removePayment(row.id) } label: { Label("Remove", systemImage: "trash") }
                    }
            }
            Button { draft.addPayment() } label: {
                Label("Add another payment", systemImage: "plus")
            }
            if f.hasEstimate && f.paidNow > 0 { balanceRow(f) }
        } header: {
            Text("Payment received")
        } footer: {
            Text("Taken as the invoice is written and filed in its payment history. Leave it empty if nothing is paid yet: a payment can still be recorded after.")
        }
    }

    /// What is left after the payments, in the ERP's words (InvoiceCredit): due, paid in full, or the
    /// customer's credit. A walk-in's extra is change, not credit, and the server refuses it.
    @ViewBuilder
    func balanceRow(_ f: SaleFigures) -> some View {
        let line = balanceLine(f.balance)
        if f.overpaid {
            LabeledContent("More than the total by") {
                Text(Money.pkr(abs(f.balance))).foregroundStyle(.red).monospacedDigit()
            }
        } else if line.state == .credit {
            LabeledContent(line.label) {
                Text(Money.pkr(line.amount)).foregroundStyle(.green).monospacedDigit()
            }
        } else if line.state == .paid {
            LabeledContent(line.label) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            }
        } else {
            LabeledContent(line.label) {
                Text(Money.pkr(line.amount)).foregroundStyle(.orange).monospacedDigit()
            }
        }
    }

    // MARK: 7. For the shop: taken by, rates off the bill, a note, the margin

    /// The house's counter names (STORE_TAKEN_BY), counted and filtered on: "Ammar" typed three ways is three
    /// people to a filter. Free text only when the house has no list.
    @ViewBuilder
    var takenByRow: some View {
        let names = session.shop.takenBy
        if names.isEmpty {
            LabeledContent("Taken by") {
                TextField("Not set", text: $draft.takenBy)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.words)
            }
        } else {
            Picker("Taken by", selection: $draft.takenBy) {
                Text("Not set").tag("")
                ForEach(names, id: \.self) { n in Text(n).tag(n) }
                // A name kept in a saved sale that the list has dropped since stays selectable.
                if !draft.takenBy.isEmpty && !names.contains(draft.takenBy) { Text(draft.takenBy).tag(draft.takenBy) }
            }
        }
    }

    /// "PKR 4,500 a gram · our cost…": the 24k rate worked into what a gram of jewellery costs the shop.
    @ViewBuilder
    func costRateRows(_ f: SaleFigures) -> some View {
        let ratti = House.margin.rattiLess ?? 0
        let perGram = SaleNumber.value(draft.costTola) / SALE_GRAMS_PER_TOLA
        let sheetTola = ((book.settings.value?.goldRatePerGram24k ?? 0) * SALE_GRAMS_PER_TOLA).rounded()
        LabeledContent("24k rate now (PKR / tola)") {
            TextField("For our margin", text: $draft.costTola)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
        if perGram > 0 {
            Text("PKR \(Money.grouped(perGram)) a gram · our cost PKR \(Money.grouped(goldCostPerGram(perGram, rattiLess: ratti))) a gram of jewellery (24k less \(SaleNumber.grams(ratti)) ratti).")
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            Text("Without it the margin is taken as \(Int((House.margin.assumedMargin * 100).rounded()))%.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        if sheetTola > 0 && sheetTola != SaleNumber.value(draft.costTola).rounded() {
            Button("Use the rate sheet's \(Money.grouped(sheetTola)) a tola") { draft.costTola = String(Int(sheetTola)) }
                .font(.caption)
                .buttonStyle(.borderless)
        }
        if let m = f.margin { marginRow(m) }
    }

    func marginWords(_ m: Margin) -> String {
        if m.assumed { return "≈ \(percentLabel(m)) (no 24k rate given — assumed)" }
        var s = "\(percentLabel(m)) · \(Money.pkr(m.profit))"
        if m.costedShare < 0.999 {
            let rest = Int(((1 - m.costedShare) * 100).rounded())
            s += " · \(rest)% of it at \(Int((House.margin.assumedMargin * 100).rounded()))% (no weight)"
        }
        return s
    }

    /// What the shop earns on this sale, blurred until tapped: the counter turns its screen to show a
    /// customer the bill, and a margin beside the total is the one thing they must not read off it.
    func marginRow(_ m: Margin) -> some View {
        let tone: Color = m.assumed ? .secondary : (m.percent < 0 ? .red : .green)
        return Button { marginShown.toggle() } label: {
            HStack(spacing: 12) {
                Label("We earn", systemImage: "lock").foregroundStyle(.secondary)
                Spacer()
                Text(marginShown ? marginWords(m) : "00.0% · PKR 00,000")
                    .monospacedDigit()
                    .foregroundStyle(tone)
                    .multilineTextAlignment(.trailing)
                    .blur(radius: marginShown ? 0 : 6)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(marginShown ? "Hide our margin" : "Show our margin")
    }

    @ViewBuilder
    func shopSection(_ f: SaleFigures) -> some View {
        Section {
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
        } header: {
            Text("For the shop")
        } footer: {
            Text("Never printed on the bill or sent to the customer.")
        }
    }

    // MARK: 7b. Delivery

    var expectedDateBinding: Binding<Date> {
        Binding(
            get: { SaleDates.date(draft.delivery.expectedDate) ?? Date() },
            set: { draft.delivery.expectedDate = SaleDates.string($0) }
        )
    }

    var hasExpectedDate: Binding<Bool> {
        Binding(
            get: { !draft.delivery.expectedDate.isEmpty },
            set: { on in draft.delivery.expectedDate = on ? SaleDates.string(Date()) : "" }
        )
    }

    @ViewBuilder
    func deliverySection(_ f: SaleFigures) -> some View {
        Section {
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
                }
                TextField("Receiver name", text: $draft.delivery.contactName, prompt: Text("If not the customer"))
                TextField("Receiver phone", text: $draft.delivery.contactPhone, prompt: Text("Optional"))
                    .keyboardType(.phonePad)
                SaleNumberField(label: "Delivery charge (PKR)", text: $draft.delivery.charge, prompt: "0 if free")
                TextField("Instructions", text: $draft.delivery.notes, prompt: Text("Landmark, timing, gate code"))
            }
        } header: {
            Text("Delivery")
        } footer: {
            Text("Off unless ticked: most sales are handed over at the counter.")
        }
    }

    // MARK: 8. Totals

    private func totalRow(_ label: String, _ value: Double, _ f: SaleFigures, signed: String = "", strong: Bool = false) -> some View {
        let font: Font = strong ? Font.title3.weight(.semibold) : Font.body
        return LabeledContent(label) {
            if f.hasEstimate {
                Text(signed + Money.pkr(value))
                    .font(font)
                    .monospacedDigit()
                    .contentTransition(.numericText(value: value))
            } else {
                Text("…").foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    func totalsSection(_ f: SaleFigures) -> some View {
        Section {
            totalRow("Subtotal", f.subtotal, f)
            if f.discount != 0 { totalRow("Discount", f.discount, f, signed: "− ") }
            if f.exchange != 0 { totalRow("Exchange", f.exchange, f, signed: "− ") }
            totalRow("Total", f.total, f, strong: true)
            if f.hasEstimate && f.paidNow > 0 {
                totalRow("Paid now", f.paidNow, f)
                balanceRow(f)
            }
        } header: {
            Text("Totals")
        }
        orderSection()
    }

    /// The same pieces can go to the workshop as an order instead (sale-page.tsx "Create order",
    /// /orders/add?fromCart=1): the order form opens on them, and the sale is cleared when the order saves.
    @ViewBuilder
    func orderSection() -> some View {
        Section {
            Button {
                // An order half typed on this phone is not thrown away without asking.
                if NewOrderDraftStore.orderInProgress { confirmingOrder = true } else { createOrder() }
            } label: {
                Label("Create order", systemImage: "list.clipboard")
            }
            .disabled(draft.lines.isEmpty)
        } footer: {
            Text("Invoice bills it now. Order sends it to the workshop first, with an advance if taken.")
        }
    }

    func createOrder() {
        NewOrderDraftStore.startFromSale(draft)
        openOrder = Route(path: "/orders/add")
    }

    /// A rate typed on the sale becomes the shop's, after the invoice is saved and never before (the invoice
    /// is priced from the rates in hand), as the web does. It is not waited for: if it does not go, the
    /// sale is still saved and a line says so.
    func keepRates(_ rates: [String: Double]) async {
        do {
            try await ERPAPI.shared.write("setRates", ["rates": rates])
        } catch {
            ratesNote = "The sale is saved. The rate you typed was not kept for next time (\(error.localizedDescription)): set it from the rate chip."
        }
    }

    // MARK: Save

    /// The one action of the screen, with the ERP's own words above it: what it refused, else why
    /// Save is off (sale-page.tsx `invoiceBlockedReason`: a disabled button with no explanation reads as broken).
    func saveBar(_ f: SaleFigures) -> some View {
        VStack(spacing: 8) {
            if let failure {
                VStack(spacing: 8) {
                    Text(failure).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                    if alreadySold {
                        // A new item is refused only once it is on an invoice: this sale was saved before
                        // (a save sent again after the answer was lost), so there is nothing to take off.
                        Text("This sale was already saved. Look for it in Invoices before saving it again.")
                            .font(.footnote.weight(.semibold))
                            .multilineTextAlignment(.center)
                        NavigationLink(value: Route(path: "/invoices")) {
                            Text("Open Invoices")
                        }
                        .buttonStyle(.glass)
                    }
                    if !goneSkus.isEmpty {
                        Button("Take them off the sale") {
                            draft.lines.removeAll { goneSkus.contains($0.sku) }
                            goneSkus = []
                            alreadySold = false
                            self.failure = nil
                        }
                        .buttonStyle(.glass)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity)
                .background(.regularMaterial, in: .rect(cornerRadius: 14))
            } else if let reason = f.blockedReason {
                Text(reason)
                    .font(.footnote)
                    .foregroundStyle(f.hasPieces ? Color.red : Color.secondary)
                    .multilineTextAlignment(.center)
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(.regularMaterial, in: .rect(cornerRadius: 14))
            }
            Button { Task { await save(f) } } label: {
                HStack(spacing: 8) {
                    if saving { ProgressView() }
                    Text(f.hasEstimate ? "Save sale · \(Money.pkr(f.total))" : "Save sale")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.houseProminent)
            .controlSize(.large)
            .disabled(!f.canSave || saving)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    /// The new invoice reaches the phone's shelf a moment after the server writes it; wait for it
    /// (a few seconds at most) so the invoice page opens on the invoice, not on "not found".
    func waitForInvoice(_ id: String) async {
        for _ in 0..<12 {
            if book.invoices.item(id) != nil { return }
            try? await Task.sleep(for: .milliseconds(250))
        }
    }

    func save(_ f: SaleFigures) async {
        guard f.canSave, !saving else { return }
        saving = true
        failure = nil
        goneSkus = []
        alreadySold = false
        // Decided before the save, from the shop's rates as they stand now.
        let kept = draft.ratesToWriteBack(f, current: book.settings.value)
        do {
            let out = try await ERPAPI.shared.write("createInvoice", draft.payload(f) { book.products.item($0)?.qrCodeDataUrl })
            let id = (out["invoice"] as? [String: Any])?["id"] as? String ?? ""
            if let kept { Task { await keepRates(kept) } }
            SaleDraftStore.clear()
            WorkDraftSync.sale.drop()
            draft = SaleDraft()
            if id.isEmpty {
                failure = "The sale was saved, but the ERP did not say its number. Look for it under Invoices."
            } else {
                await waitForInvoice(id)
                made = id
            }
        } catch let e as ERPAPI.Failure {
            // The ERP's own words, as they come: a piece sold meanwhile is a 409 that names it.
            failure = e.message
            if e.status == 409 {
                let refused = SaleLookup.refusal(in: e.message, lines: draft.lines)
                goneSkus = refused.gone
                alreadySold = refused.alreadySold
            }
        } catch {
            failure = error.localizedDescription
        }
        saving = false
    }
}
