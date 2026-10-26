#if os(macOS)
import SwiftUI
import ERPCore

// New order, the right panel's Order tab (docs/features/mac-design.md, "New order"): Rates, Payment (the discount with its
// Round menu, the advance, how it was paid), Exchange, Delivery, Notes and our margin. The phone's sections, on the same
// `NewOrderDraft`, with plain headers and a Round menu where the phone has round-off chips.

struct MacNewOrderOrderForm: View {
    @Binding var draft: NewOrderDraft
    let totals: NewOrderMath.Totals
    let settings: Settings?
    /// The customer's saved address and every one they have had pieces delivered to (offered, never filled in by itself).
    let knownAddresses: () -> [String]
    let margin: () -> Margin?
    /// Change rate (the order page's `?rates=1`) puts the rates first.
    let ratesFirst: Bool

    var body: some View {
        Form {
            if ratesFirst { MacNewOrderRates(draft: $draft, settings: settings) }
            MacNewOrderPayment(draft: $draft, totals: totals)
            MacNewOrderExchange(draft: $draft)
            if !ratesFirst { MacNewOrderRates(draft: $draft, settings: settings) }
            MacNewOrderDelivery(draft: $draft, knownAddresses: knownAddresses)
            MacNewOrderNotes(draft: $draft)
            if House.margin.rattiLess != nil {
                MacNewOrderMargin(draft: $draft, settings: settings, margin: margin)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
    }
}

// MARK: Rates

struct MacNewOrderRates: View {
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

    /// Only the rates this order uses, as the web shows them: add an 18k piece and the 18k rate appears; remove it and it goes.
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
        // Silver's one all-in rate (it holds the making and wastage); typed on the order, else the shop's.
        if hasSilver { out.append(Box(key: .silverRatePerGram, label: "Silver (all-in)")) }
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

    private var footer: String {
        var s = "A rate typed here is used for this order only: today's rates are changed with the rate in the toolbar."
        if hasPalladium { s += " A palladium rate left at zero falls back to the shop's flat palladium rate." }
        if hasSilver { s += " Silver's rate already holds its making and wastage; the number is this order's own." }
        return s
    }

    var body: some View {
        if !boxes.isEmpty {
            Section {
                ForEach(boxes) { box in
                    LabeledContent(box.label) {
                        TextField(box.label, text: binding(box.key), prompt: Text("0"))
                            .labelsHidden()
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                    }
                }
                if differs, let settings {
                    Button("Use Today's Rates") { draft.rates = NewOrderMath.todaysRates(settings) }
                        .buttonStyle(.link)
                }
            } header: {
                Text("Metal Rates (PKR / gram)")
            } footer: {
                Text(footer)
            }
        }
        // The rates still price the order; this only decides whether the paper says what they were.
        Section {
            Toggle("Leave rates off the printed bill", isOn: $draft.hideRates)
        } footer: {
            Text("Prices stay the same. The slip and the invoice just won't show the per-gram rate.")
        }
    }
}

// MARK: Payment

struct MacNewOrderPayment: View {
    @Binding var draft: NewOrderDraft
    /// The form's figures (`liveEstimate`), for the round-off offers.
    let totals: NewOrderMath.Totals

    /// The discount before a Round pick, and the bill it made: the pick is ticked while the bill still comes to it.
    @State private var applied: Applied?

    private struct Applied: Equatable {
        let base: Double
        let target: Double
    }

    /// The bill before any discount: the pieces less the exchange (the advance is a payment).
    private var payable: Double { totals.subtotal - totals.exchange }

    var body: some View {
        Section {
            LabeledContent("Discount (PKR)") {
                HStack(spacing: 6) {
                    TextField("Discount", text: $draft.discount.wholeRupees, prompt: Text("0"))
                        .labelsHidden()
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                    roundMenu
                }
            }
            NewOrderNumberRow(title: "Advance paid (PKR)", text: $draft.advance, rupees: true)
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

    /// Round the bill down to a round number (up to three offers, ERPCore's rule): the pick adds its extra to the discount
    /// typed; picking the ticked one puts the discount back as it was.
    private var roundMenu: some View {
        let disc = rupees(totals.discount)
        let whole = rupees(payable)
        let lit: Applied? = applied.flatMap { whole - disc == $0.target ? $0 : nil }
        let base = lit?.base ?? disc
        let offers = roundOffOffers(whole, base)
        return Menu("Round") {
            ForEach(offers, id: \.target) { o in
                let chosen = lit?.target == o.target
                Button {
                    if chosen {
                        applied = nil
                        draft.discount = NewOrderFormat.rupeeBox(base)
                    } else {
                        applied = Applied(base: base, target: o.target)
                        draft.discount = NewOrderFormat.rupeeBox(discountWithOffer(base, o))
                    }
                } label: {
                    if chosen {
                        Label(roundOffLabel(o), systemImage: "checkmark")
                    } else {
                        Text(roundOffLabel(o))
                    }
                }
            }
        }
        .disabled(offers.isEmpty)
        .help("Round the bill down to a round number by adding to the discount")
    }
}

// MARK: Exchange

/// Old gold or a piece the customer hands over, taken off the bill at an agreed value: what it is and the amount that comes
/// off; grams and rate fill the amount until someone types their own (ERPCore's `applyExchangeRowChange`).
struct MacNewOrderExchange: View {
    @Binding var draft: NewOrderDraft

    private let karats = ["24k", "22k", "21k", "18k"]

    private var total: Double { exchangeRowsTotal(draft.exchanges.map { $0.row }) }

    private func text(
        _ id: String,
        _ read: @escaping (NewOrderExchangeDraft) -> String,
        _ patch: @escaping (String) -> ExchangeRowPatch
    ) -> Binding<String> {
        Binding(
            get: { draft.exchanges.first { $0.id == id }.map(read) ?? "" },
            set: { typed in draft.patchExchange(id, patch(typed)) }
        )
    }

    private func remove(_ id: String) {
        if draft.exchanges.count > 1 {
            draft.exchanges.removeAll { $0.id == id }
        } else {
            draft.exchanges = [.blank()]
        }
    }

    var body: some View {
        Section {
            ForEach(draft.exchanges) { row in
                exchangeRow(row)
            }
            Button { draft.exchanges.append(.blank()) } label: { Label("Add Another Exchange", systemImage: "plus") }
                .buttonStyle(.borderless)
            if draft.exchanges.count > 1 && total > 0 {
                LabeledContent("Exchange total") {
                    Text(Money.pkr(total)).monospacedDigit().fontWeight(.medium)
                }
            }
        } header: {
            Text("Exchange / Trade-In")
        }
    }

    private func exchangeRow(_ row: NewOrderExchangeDraft) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                TextField("What it is", text: text(row.id, { $0.description }, { ExchangeRowPatch(description: $0) }),
                          prompt: Text("What it is (e.g. old ring)"))
                    .labelsHidden()
                TextField("Amount", text: text(row.id, { $0.value }, { ExchangeRowPatch(value: $0) }).wholeRupees, prompt: Text("Amount"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(width: 90)
                Button { remove(row.id) } label: { Image(systemName: "minus.circle") }
                    .buttonStyle(.borderless)
                    .help("Remove this exchange")
            }
            HStack(spacing: 8) {
                // Karat only means something where the house sells gold; a silver house weighs without it.
                if House.metal == "gold" {
                    Picker("Karat", selection: text(row.id, { $0.karat }, { ExchangeRowPatch(karat: $0) })) {
                        Text("Karat").tag("")
                        ForEach(karats, id: \.self) { k in
                            Text(k).tag(k)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 90)
                }
                TextField("Grams", text: text(row.id, { $0.weightG }, { ExchangeRowPatch(weightG: $0) }), prompt: Text("Grams"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                TextField("Rate", text: text(row.id, { $0.ratePerGram }, { ExchangeRowPatch(ratePerGram: $0) }), prompt: Text("Rate / g"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            }
            if !row.valueTyped && NewOrderFormat.num(row.weightG) > 0 && NewOrderFormat.num(row.ratePerGram) > 0 {
                Text("Amount = grams \u{00D7} rate: type an amount to change it.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: Delivery and notes

/// "Is this being delivered?" Off by default, because most pieces are collected from the shop.
struct MacNewOrderDelivery: View {
    @Binding var draft: NewOrderDraft
    let knownAddresses: () -> [String]

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
        let offered = knownAddresses().filter { $0 != NewOrderFormat.trim(draft.deliveryAddress) }
        if offered.count == 1, let only = offered.first {
            Button("Use Their Address on File") { draft.deliveryAddress = only }
                .buttonStyle(.link)
        } else if offered.count > 1 {
            Menu {
                ForEach(offered, id: \.self) { a in
                    Button(a) { draft.deliveryAddress = a }
                }
            } label: {
                Label("Addresses on File (\(offered.count))", systemImage: "mappin.and.ellipse")
            }
        }
        TextField("Address", text: $draft.deliveryAddress, prompt: Text("House / flat, street, area"), axis: .vertical)
            .lineLimit(2...4)
        LabeledContent("City") {
            TextField("City", text: $draft.deliveryCity, prompt: Text("Karachi"))
                .labelsHidden()
                .multilineTextAlignment(.trailing)
        }
        LabeledContent("Receiver") {
            TextField("Receiver's name", text: $draft.deliveryName, prompt: Text("If not the customer"))
                .labelsHidden()
                .multilineTextAlignment(.trailing)
        }
        LabeledContent("Receiver's phone") {
            TextField("Receiver's phone", text: $draft.deliveryPhone, prompt: Text("Optional"))
                .labelsHidden()
                .multilineTextAlignment(.trailing)
        }
        NewOrderNumberRow(title: "Delivery charge (PKR)", text: $draft.deliveryCharge, prompt: "0 if free", rupees: true)
        LabeledContent("Instructions") {
            TextField("Instructions", text: $draft.deliveryNotes, prompt: Text("Landmark, timing, gate"))
                .labelsHidden()
                .multilineTextAlignment(.trailing)
        }
        Toggle("Expected on a day", isOn: expectedOn)
        if !draft.deliveryExpected.isEmpty {
            DatePicker("Expected", selection: expectedDate, displayedComponents: .date)
                .datePickerStyle(.field)
                .environment(\.timeZone, ERPDate.karachi)
        }
    }
}

struct MacNewOrderNotes: View {
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

// MARK: The shop's margin

/// SHOP-ONLY, owners and staff (shop-margin.tsx): the 24k rate now, and what the order earns, blurred until clicked: the
/// counter turns its screen to show a customer the bill, and a margin beside the total is the one thing they must not read
/// off it. A house that does not cost by gold (Mina) has none.
struct MacNewOrderMargin: View {
    @Binding var draft: NewOrderDraft
    let settings: Settings?
    let margin: () -> Margin?

    @State private var shown = false

    private var perGram: Double { NewOrderMath.costRatePerGram(draft) }

    private var sheetTola: Int {
        Int(((settings?.goldRatePerGram24k ?? 0) * NewOrderWords.gramsPerTola).rounded())
    }

    private var assumedPercent: Int { Int((House.margin.assumedMargin * 100).rounded()) }

    var body: some View {
        Section {
            LabeledContent {
                TextField("24k rate", text: $draft.costTola, prompt: Text("Leave empty for \(assumedPercent)%"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
            } label: {
                Label("24k rate now (per tola)", systemImage: "lock.fill")
            }
            Text(rateWords)
                .font(.callout)
                .foregroundStyle(.secondary)
            if sheetTola > 0 && Double(sheetTola) != NewOrderFormat.num(draft.costTola) {
                Button("Use the Rate Sheet's \(Money.grouped(Double(sheetTola))) a Tola") {
                    draft.costTola = String(sheetTola)
                }
                .buttonStyle(.link)
            }
            Button { shown.toggle() } label: {
                HStack {
                    Label("We earn", systemImage: "lock.fill").foregroundStyle(.secondary)
                    Spacer()
                    Text(shown ? words : "00.0% \u{00B7} PKR 00,000")
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .blur(radius: shown ? 0 : 5)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(shown ? "Hide our margin" : "Show our margin")
        } header: {
            Text("Our Margin (Shop Only)")
        } footer: {
            Text("Never printed, and never on anything the customer sees.")
        }
    }

    private var rateWords: String {
        if perGram > 0 {
            let cost = goldCostPerGram(perGram, rattiLess: House.margin.rattiLess ?? 0)
            return "\(Money.pkr(perGram)) a gram \u{00B7} our cost \(Money.pkr(cost)) a gram of jewellery (24k less \(NewOrderFormat.trimmed(House.margin.rattiLess ?? 0, digits: 1)) ratti)."
        }
        return "Without it the margin is taken as \(assumedPercent)%."
    }

    /// What is read when the figure is clicked (shop-margin.tsx MarginFigure).
    private var words: String {
        guard let m = margin() else { return "\u{2014}" }
        if m.assumed { return "\u{2248} \(percentLabel(m)) (no 24k rate given: assumed)" }
        var s = "\(percentLabel(m)) \u{00B7} \(Money.pkr(m.profit))"
        if m.costedShare < 0.999 {
            let rest = Int(((1 - m.costedShare) * 100).rounded())
            s += " \u{00B7} \(rest)% of it at \(assumedPercent)% (no weight)"
        }
        return s
    }
}
#endif
