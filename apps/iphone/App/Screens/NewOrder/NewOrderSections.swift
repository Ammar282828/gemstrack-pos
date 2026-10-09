import SwiftUI
import ERPCore

// The order form's sections, one view each: who it is for, when, the money (rates, discount, advance,
// exchange), notes, delivery, the shop's margin, and the totals. Each takes the whole draft as a
// binding; the figures it shows come from NewOrderMath, which is ERPCore's.

// MARK: Who it is for

struct NewOrderCustomerSection: View {
    @Binding var draft: NewOrderDraft
    /// Customers who are people: not removed, not the old "Walk-in Customer" records.
    let people: [Customer]
    /// The house's counter names (`Session.Shop.takenBy`, STORE_TAKEN_BY). "Taken by" is one of them; free text
    /// only where the house has no list.
    let takenBy: [String]

    @FocusState private var nameFocused: Bool

    /// Typing makes it a new customer again (the web's autocomplete does the same): only a pick from
    /// the list is a customer on file.
    private var nameBinding: Binding<String> {
        Binding(
            get: { draft.customerName },
            set: { typed in draft.typeCustomerName(typed) }
        )
    }

    private var suggestions: [Customer] {
        let q = NewOrderFormat.trim(draft.customerName)
        guard nameFocused, draft.customerId.isEmpty, !q.isEmpty else { return [] }
        return Array(people.filter { $0.name.localizedCaseInsensitiveContains(q) }.prefix(5))
    }

    /// A typed number already on file is that customer (lib/walk-in.ts): said here, so it is no surprise.
    private var numberMatch: Customer? {
        guard draft.customerId.isEmpty, !phoneKey(draft.customerPhone).isEmpty else { return nil }
        let r = resolveSaleCustomer(selectedId: nil, typedName: draft.customerName, typedPhone: draft.customerPhone, customers: people)
        guard let id = r.id else { return nil }
        return people.first { $0.id == id }
    }

    var body: some View {
        Section {
            takenByRow
            TextField("Customer name", text: nameBinding, prompt: Text("Walk-in if left empty"))
                .textInputAutocapitalization(.words)
                .focused($nameFocused)
            ForEach(suggestions) { c in
                suggestionRow(c)
            }
            if !draft.customerId.isEmpty { onFileRow }
            TextField("Phone", text: $draft.customerPhone, prompt: Text("Optional"))
                .keyboardType(.phonePad)
            if let match = numberMatch {
                Label("This number is \(match.name)'s: the order goes to them.", systemImage: "person.crop.circle.badge.checkmark")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Picker("How they found us", selection: $draft.source) {
                Text("Not specified").tag("")
                ForEach(NewOrderWords.sources) { s in
                    Text(s.label).tag(s.id)
                }
            }
        } header: {
            Text("Order for")
        }
    }

    /// Counted by name, so the list is fixed and "Ammar" typed three ways is not three people to a filter
    /// (taken-by-picker.tsx). It starts on the signed-in person, and always shows who it is.
    @ViewBuilder
    private var takenByRow: some View {
        if takenBy.isEmpty {
            LabeledContent("Taken by") {
                TextField("Taken by", text: $draft.takenBy, prompt: Text("Not set"))
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.words)
            }
        } else {
            Picker("Taken by", selection: $draft.takenBy) {
                Text("Not set").tag("")
                ForEach(takenBy, id: \.self) { name in
                    Text(name).tag(name)
                }
            }
        }
    }

    private func suggestionRow(_ c: Customer) -> some View {
        Button { pick(c) } label: {
            HStack {
                Image(systemName: "person").foregroundStyle(.secondary)
                Text(c.name)
                Spacer(minLength: 8)
                if let phone = c.phone, !phone.isEmpty {
                    Text(phone).font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }

    private var onFileRow: some View {
        HStack {
            Label("On file", systemImage: "person.crop.circle.badge.checkmark")
                .foregroundStyle(.green)
            Spacer()
            Button("Not them") { draft.customerId = "" }
                .buttonStyle(.borderless)
        }
        .font(.subheadline)
    }

    private func pick(_ c: Customer) {
        draft.choose(c)
        nameFocused = false
    }
}

// MARK: When

struct NewOrderPromisedSection: View {
    @Binding var draft: NewOrderDraft

    /// Seven, ten and fourteen days are what the counter actually says to a customer.
    private let quick = [7, 10, 14]

    private var days: Int? { NewOrderDay.daysAway(draft.promised) }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { NewOrderDay.date(draft.promised) ?? Date() },
            set: { draft.promised = NewOrderDay.string($0) }
        )
    }

    /// Inside a bench week, or already behind: said at the moment of choosing, so the counter sees what
    /// it is committing the workshop to.
    private func urgentWords(_ d: Int) -> String {
        if d < 0 { return "Urgent · past" }
        if d == 0 { return "Urgent · today" }
        return "Urgent · \(d)d"
    }

    var body: some View {
        Section {
            HStack(spacing: 8) {
                ForEach(quick, id: \.self) { d in
                    NewOrderChip(title: "\(d)d", on: draft.promised == NewOrderDay.after(d)) {
                        draft.promised = NewOrderDay.after(d)
                    }
                }
                NewOrderChip(title: "No date", on: draft.promised.isEmpty) {
                    draft.promised = ""
                }
            }
            if !draft.promised.isEmpty {
                DatePicker("Date promised", selection: dateBinding, displayedComponents: .date)
                    .environment(\.timeZone, ERPDate.karachi)
                if let d = days, d <= URGENT_WINDOW_DAYS {
                    Label(urgentWords(d), systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.red)
                }
            }
        } header: {
            Text("Promised for")
        } footer: {
            Text("What the piece is chased against. Within \(URGENT_WINDOW_DAYS) days is marked urgent.")
        }
    }
}

// MARK: The pieces

struct NewOrderPiecesFooter: View {
    let count: Int

    var body: some View {
        Text(count == 0 ? "Add one or more pieces to see the price." : NewOrderFormat.pieces(count) + " on this order")
    }
}

// MARK: Rates

struct NewOrderRatesSection: View {
    @Binding var draft: NewOrderDraft
    let settings: Settings?

    private struct Box: Identifiable {
        let key: RateKey
        let label: String
        var id: String { key.rawValue }
    }

    private var goldKarats: Set<String> {
        Set(draft.pieces.filter { $0.metal == "gold" }.map { $0.karat })
    }

    private var palladiumKarats: Set<String> {
        Set(draft.pieces.filter { $0.metal == "palladium" }.map { $0.karat })
    }

    private var hasPalladium: Bool { draft.pieces.contains { $0.metal == "palladium" } }
    private var hasSilver: Bool { draft.pieces.contains { $0.metal == "silver" } }

    /// Only the rates this order uses, as the web shows them: a box that is on screen looks like a box that
    /// must be checked. Add an 18k piece and the 18k rate appears; remove it and it goes.
    private var boxes: [Box] {
        var out: [Box] = []
        let gold: [(RateKey, String)] = [
            (.goldRatePerGram24k, "24k"), (.goldRatePerGram22k, "22k"),
            (.goldRatePerGram21k, "21k"), (.goldRatePerGram18k, "18k"),
        ]
        for (key, karat) in gold where goldKarats.contains(karat) {
            out.append(Box(key: key, label: "Gold " + karat))
        }
        if hasPalladium {
            let pd: [(RateKey, String)] = [(.palladiumRatePerGram18k, "18k"), (.palladiumRatePerGram12k, "12k")]
            for (key, karat) in pd where palladiumKarats.isEmpty || palladiumKarats.contains(karat) {
                out.append(Box(key: key, label: "Palladium " + karat))
            }
        }
        return out
    }

    private func binding(_ key: RateKey) -> Binding<String> {
        Binding(
            get: { draft.rates[key.rawValue] ?? "" },
            set: { draft.rates[key.rawValue] = $0 }
        )
    }

    /// Typed rates that are no longer today's.
    private var differs: Bool {
        guard let settings else { return false }
        let today = settings.rates
        return boxes.contains { box in
            let typed = NewOrderFormat.num(draft.rates[box.key.rawValue] ?? "")
            return abs(typed - (today[box.key] ?? 0)) >= 0.005
        }
    }

    var body: some View {
        if !boxes.isEmpty || hasSilver {
            Section {
                ForEach(boxes) { box in
                    LabeledContent(box.label) {
                        TextField(box.label, text: binding(box.key), prompt: Text("0"))
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                    }
                }
                if hasSilver, let settings {
                    LabeledContent("Silver (all-in)") {
                        Text(Money.pkr(settings.silverRatePerGram) + "/g").monospacedDigit()
                    }
                }
                if differs, let settings {
                    Button("Use today's rates") { draft.rates = NewOrderMath.todaysRates(settings) }
                        .buttonStyle(.borderless)
                }
            } header: {
                Text("Metal rates (PKR / gram)")
            } footer: {
                Text(footer)
            }
        }
    }

    private var footer: String {
        var s = "Applies to every piece on this order, and is kept on it. A rate typed here is used for this order only: today's rates are changed with the rate chip."
        if hasPalladium { s += " A palladium rate left at zero falls back to the shop's flat palladium rate." }
        if hasSilver { s += " Silver is priced at the shop's rate, which already holds its making and wastage." }
        return s
    }
}

/// The rates still price the order; this only decides whether the paper says what they were. Some
/// customers are quoted a piece and not a gold price, and a rate line on the slip reopens a
/// conversation the counter has already closed.
struct NewOrderPrintedSection: View {
    @Binding var draft: NewOrderDraft

    var body: some View {
        Section {
            Toggle("Leave rates off the printed bill", isOn: $draft.hideRates)
        } footer: {
            Text("Prices stay the same. The slip and the invoice just won't show the per-gram rate.")
        }
    }
}

// MARK: Payment

struct NewOrderPaymentSection: View {
    @Binding var draft: NewOrderDraft

    var body: some View {
        Section {
            NewOrderNumberRow(title: "Discount (PKR)", text: $draft.discount)
            NewOrderNumberRow(title: "Advance paid (PKR)", text: $draft.advance)
            if NewOrderFormat.num(draft.advance) > 0 {
                Picker("Paid by", selection: $draft.advanceMethod) {
                    Text("Not recorded").tag("")
                    ForEach(PaymentMethods.all, id: \.self) { m in
                        Text(m).tag(m)
                    }
                }
            }
        } header: {
            Text("Payment")
        } footer: {
            Text("The discount is carried onto the invoice when this order is finalised.")
        }
    }
}

// MARK: Exchange

/// Old gold or a piece the customer hands over, taken off the bill at an agreed value. One line: what it
/// is and the amount that comes off; weight and rate fold away under it and fill the amount until
/// someone types their own (components/shared/exchange-rows.tsx; ERPCore's `applyExchangeRowChange`).
struct NewOrderExchangeSection: View {
    @Binding var draft: NewOrderDraft
    @State private var opened: Set<String> = []

    private let karats = ["24k", "22k", "21k", "18k"]

    var body: some View {
        Section {
            ForEach(draft.exchanges) { row in
                exchangeRow(row)
            }
            Button {
                draft.exchanges.append(.blank())
            } label: {
                Label("Add another exchange", systemImage: "plus")
            }
            if draft.exchanges.count > 1 && total > 0 {
                LabeledContent("Exchange total") {
                    Text(Money.pkr(total)).monospacedDigit().fontWeight(.medium)
                }
            }
        } header: {
            Text("Exchange / trade-in")
        } footer: {
            Text("Old gold or a piece the customer hands over, taken off the bill at an agreed value.")
        }
    }

    private var total: Double { exchangeRowsTotal(draft.exchanges.map { $0.row }) }

    private func apply(_ id: String, _ patch: ExchangeRowPatch) {
        draft.patchExchange(id, patch)
    }

    private func text(
        _ id: String,
        _ read: @escaping (NewOrderExchangeDraft) -> String,
        _ patch: @escaping (String) -> ExchangeRowPatch
    ) -> Binding<String> {
        Binding(
            get: { draft.exchanges.first { $0.id == id }.map(read) ?? "" },
            set: { typed in apply(id, patch(typed)) }
        )
    }

    private func remove(_ id: String) {
        if draft.exchanges.count > 1 {
            draft.exchanges.removeAll { $0.id == id }
        } else {
            draft.exchanges = [.blank()]
        }
    }

    @ViewBuilder
    private func exchangeRow(_ row: NewOrderExchangeDraft) -> some View {
        let showDetails = opened.contains(row.id) || !row.karat.isEmpty || !row.weightG.isEmpty || !row.ratePerGram.isEmpty
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TextField("What it is", text: text(row.id, { $0.description }, { ExchangeRowPatch(description: $0) }),
                          prompt: Text("What it is (e.g. old ring)"))
                TextField("Amount", text: text(row.id, { $0.value }, { ExchangeRowPatch(value: $0) }), prompt: Text("Amount"))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(width: 110)
            }
            if showDetails {
                details(row)
            } else {
                Button("+ Weight & rate") { opened.insert(row.id) }
                    .font(.footnote)
                    .buttonStyle(.borderless)
            }
        }
        .swipeActions {
            Button(role: .destructive) { remove(row.id) } label: {
                Label("Remove", systemImage: "trash")
            }
        }
    }

    @ViewBuilder
    private func details(_ row: NewOrderExchangeDraft) -> some View {
        let computed = !row.valueTyped && NewOrderFormat.num(row.weightG) > 0 && NewOrderFormat.num(row.ratePerGram) > 0
        HStack(spacing: 10) {
            // Karat only means something where the house sells gold; a silver house weighs without it.
            if House.metal == "gold" {
                Picker("Karat", selection: text(row.id, { $0.karat }, { ExchangeRowPatch(karat: $0) })) {
                    Text("Karat").tag("")
                    ForEach(karats, id: \.self) { k in
                        Text(k).tag(k)
                    }
                }
                .labelsHidden()
            }
            TextField("Grams", text: text(row.id, { $0.weightG }, { ExchangeRowPatch(weightG: $0) }), prompt: Text("Grams"))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
            TextField("Rate", text: text(row.id, { $0.ratePerGram }, { ExchangeRowPatch(ratePerGram: $0) }), prompt: Text("Rate / g"))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
        if computed {
            Text("Amount = grams × rate: type an amount to change it.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: Notes and delivery

struct NewOrderNotesSection: View {
    @Binding var draft: NewOrderDraft

    var body: some View {
        Section {
            TextField("Notes", text: $draft.notes, prompt: Text("Anything the shop should remember"), axis: .vertical)
                .lineLimit(2...6)
        } header: {
            Text("Notes")
        } footer: {
            Text("Kept with the order and carried to its invoice as a note for the shop. Never printed.")
        }
    }
}

/// "Is this being delivered?" Off by default, because most pieces are collected from the shop.
struct NewOrderDeliverySection: View {
    @Binding var draft: NewOrderDraft
    /// The address the customer on file has, offered, never filled in by itself.
    let addressOnFile: String?

    private var expectedOn: Binding<Bool> {
        Binding(
            get: { !draft.deliveryExpected.isEmpty },
            set: { draft.deliveryExpected = $0 ? NewOrderDay.today : "" }
        )
    }

    private var expectedDate: Binding<Date> {
        Binding(
            get: { NewOrderDay.date(draft.deliveryExpected) ?? Date() },
            set: { draft.deliveryExpected = NewOrderDay.string($0) }
        )
    }

    var body: some View {
        Section {
            Toggle("Deliver this", isOn: $draft.deliver)
            if draft.deliver { fields }
        } header: {
            Text("Delivery")
        }
    }

    @ViewBuilder
    private var fields: some View {
        if let on = addressOnFile, on != NewOrderFormat.trim(draft.deliveryAddress) {
            Button("Use their address on file") { draft.deliveryAddress = on }
                .buttonStyle(.borderless)
        }
        TextField("Address", text: $draft.deliveryAddress, prompt: Text("House / flat, street, area"), axis: .vertical)
            .lineLimit(2...4)
        TextField("City", text: $draft.deliveryCity, prompt: Text("Karachi"))
        TextField("Receiver's name", text: $draft.deliveryName, prompt: Text("If not the customer"))
            .textInputAutocapitalization(.words)
        TextField("Receiver's phone", text: $draft.deliveryPhone, prompt: Text("Optional"))
            .keyboardType(.phonePad)
        NewOrderNumberRow(title: "Delivery charge (PKR)", text: $draft.deliveryCharge, prompt: "0 if free")
        TextField("Instructions", text: $draft.deliveryNotes, prompt: Text("Landmark, timing, gate code"))
        Toggle("Expected on a day", isOn: expectedOn)
        if !draft.deliveryExpected.isEmpty {
            DatePicker("Expected", selection: expectedDate, displayedComponents: .date)
                .environment(\.timeZone, ERPDate.karachi)
        }
    }
}

// MARK: The shop's margin

/// SHOP-ONLY, owners and staff (shop-margin.tsx): the 24k rate now, and what the order earns, blurred until tapped: the
/// counter turns its screen to show a customer the bill, and a margin beside the total is the one thing they
/// must not read off it. The figure is not worked out until it is tapped. A house that does not cost by gold
/// (Mina) has none.
struct NewOrderMarginSection: View {
    @Binding var draft: NewOrderDraft
    let settings: Settings?
    let margin: () -> Margin?

    @State private var shown = false

    private var perGram: Double { NewOrderMath.costRatePerGram(draft) }

    private var sheetTola: Int {
        Int(((settings?.goldRatePerGram24k ?? 0) * NewOrderWords.gramsPerTola).rounded())
    }

    var body: some View {
        Section {
            LabeledContent {
                TextField("24k rate", text: $draft.costTola, prompt: Text("Leave empty for \(assumedPercent)%"))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            } label: {
                Label("24k rate now (per tola)", systemImage: "lock.fill")
            }
            Text(rateWords)
                .font(.footnote)
                .foregroundStyle(.secondary)
            if sheetTola > 0 && Double(sheetTola) != NewOrderFormat.num(draft.costTola) {
                Button("Use the rate sheet's \(Money.grouped(Double(sheetTola))) a tola") {
                    draft.costTola = String(sheetTola)
                }
                .buttonStyle(.borderless)
                .font(.footnote)
            }
            Button { shown.toggle() } label: {
                HStack {
                    Label("We earn", systemImage: "lock.fill").foregroundStyle(.secondary)
                    Spacer()
                    Text(shown ? words : "00.0% · PKR 00,000")
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .blur(radius: shown ? 0 : 5)
                }
                .font(.subheadline)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(shown ? "Hide our margin" : "Show our margin")
        } header: {
            Text("Our margin (shop only)")
        } footer: {
            Text("Never printed, and never on anything the customer sees.")
        }
    }

    private var assumedPercent: Int { Int((House.margin.assumedMargin * 100).rounded()) }

    private var rateWords: String {
        if perGram > 0 {
            let cost = goldCostPerGram(perGram, rattiLess: House.margin.rattiLess ?? 0)
            return "\(Money.pkr(perGram)) a gram · our cost \(Money.pkr(cost)) a gram of jewellery (24k less \(NewOrderFormat.trimmed(House.margin.rattiLess ?? 0, digits: 1)) ratti)."
        }
        return "Without it the margin is taken as \(assumedPercent)%."
    }

    /// What is read when the figure is tapped (shop-margin.tsx MarginFigure).
    private var words: String {
        guard let m = margin() else { return "—" }
        if m.assumed { return "≈ \(percentLabel(m)) (no 24k rate given: assumed)" }
        var s = "\(percentLabel(m)) · \(Money.pkr(m.profit))"
        if m.costedShare < 0.999 {
            let rest = Int(((1 - m.costedShare) * 100).rounded())
            s += " · \(rest)% of it at \(assumedPercent)% (no weight)"
        }
        return s
    }
}

// MARK: The totals

/// The arithmetic as a running deduction: what the pieces come to, what comes off, and what is left.
/// `grandTotal` is stored NET of all of it, so it is the balance still owed (lib/order-payment.ts).
struct NewOrderTotalsSection: View {
    let totals: NewOrderMath.Totals
    let pieces: Int

    private func minus(_ title: String, _ amount: Double) -> some View {
        LabeledContent(title) {
            HStack(spacing: 3) {
                Text("−")
                MoneyText(amount: amount, exact: true)
            }
        }
    }

    var body: some View {
        Section {
            LabeledContent("Items · " + NewOrderFormat.pieces(pieces)) {
                MoneyText(amount: totals.subtotal, exact: true)
            }
            if totals.discount > 0 { minus("Discount", totals.discount) }
            if totals.advance > 0 { minus("Advance paid", totals.advance) }
            if totals.exchange > 0 { minus("Taken in exchange", totals.exchange) }
            LabeledContent("Balance due") {
                MoneyText(amount: totals.balance, exact: true)
                    .font(.title3.weight(.bold))
            }
        } header: {
            Text("Totals")
        } footer: {
            if totals.balance < 0 {
                Text("More has been taken than the pieces come to.")
            }
        }
    }
}
