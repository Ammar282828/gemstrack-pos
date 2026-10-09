import SwiftUI
import ERPCore

/// Every attribute of a line on the sale, not only its price (components/cart/edit-cart-item-dialog.tsx):
/// the name, category, size, metal, weights, plating, and each charge. The line total at the foot is
/// worked out by the same `calculateProductCosts` the sale uses, so what is shown here is what the
/// invoice will say. Changes are for this sale only; the piece in stock is untouched.
///
/// With `create` it is the web's "New item": a piece that was never in inventory, described to be
/// billed on this sale only. The same fields, and the name is required before it can be added.
///
/// Unlike the web, a palladium piece keeps its karat when edited (the web's patch drops it for any
/// metal but gold, which would price an 18k palladium piece at the flat rate).
struct SaleLineEditor: View {
    let line: SaleLine
    let rates: PricingRates
    var create = false
    let apply: (SaleLine) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var f: Fields

    init(line: SaleLine, rates: PricingRates, create: Bool = false, apply: @escaping (SaleLine) -> Void) {
        self.line = line
        self.rates = rates
        self.create = create
        self.apply = apply
        _f = State(initialValue: Fields(line))
    }

    /// Everything the sheet edits, as text (SaleModel.swift: the contract tests run the same code).
    typealias Fields = SaleLineFields

    private var silver: Bool { f.metalType == "silver" }

    private var karatOptions: [String] {
        let allowed = karatsFor(f.metalType).map { $0.rawValue }
        // A karat the piece already carries stays selectable even if the metal's list no longer offers it.
        if !f.karat.isEmpty && !allowed.contains(f.karat) && metalHasKarat(f.metalType) { return allowed + [f.karat] }
        return allowed
    }

    private var preview: Double {
        calculateProductCosts(f.applied(to: line).priced, rates).totalPrice
    }

    var body: some View {
        NavigationStack {
            Form { Group {
                pieceSection
                if silver { finishSection }
                sizeSection
                priceSection
                stonesSection
                billSection
                totalSection
                }
                .houseRows()
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(create ? "New item" : (line.stockSku ?? "Edit piece"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(create ? "Add to bill" : "Apply") {
                        apply(f.applied(to: line))
                        dismiss()
                    }
                    // A new item needs a name before it can go on the bill (the web's dialog, mode "create").
                    .disabled(create && f.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { SaleKeyboard.dismiss() }
                }
            }
            .onChange(of: f.metalType) { _, new in
                // The karat follows the metal: none for silver, a listed one for gold and palladium.
                let allowed = karatsFor(new).map { $0.rawValue }
                if allowed.isEmpty {
                    f.karat = ""
                } else if !allowed.contains(f.karat) {
                    f.karat = allowed.contains("21k") ? "21k" : (allowed.first ?? "")
                }
            }
        }
        .presentationDetents([.large])
    }

    // MARK: Sections

    private var pieceSection: some View {
        Section {
            Picker("Category", selection: $f.categoryId) {
                Text("Not set").tag("")
                ForEach(SaleCategories.all) { c in Text(c.title).tag(c.id) }
                if !f.categoryId.isEmpty && SaleCategories.title(f.categoryId) == nil {
                    Text(f.categoryId).tag(f.categoryId)
                }
            }
            TextField("Item name", text: $f.name, prompt: Text("What is being sold"))
            Picker("Metal", selection: $f.metalType) {
                ForEach(METAL_TYPES, id: \.rawValue) { m in Text(metalLabel(m)).tag(m.rawValue) }
                if !METAL_TYPES.contains(where: { $0.rawValue == f.metalType }) { Text(f.metalType).tag(f.metalType) }
            }
            if !karatOptions.isEmpty {
                Picker("Karat", selection: $f.karat) {
                    ForEach(karatOptions, id: \.self) { k in Text(karatLabel(k)).tag(k) }
                }
            }
        } header: {
            Text("The piece")
        } footer: {
            if create {
                Text("Describe the piece you are billing. It goes on this invoice only: your stock is untouched.")
            }
        }
    }

    // MARK: Size

    /// A category with a scale picks its size from it, as the web's SizePicker does (a set with two parts
    /// keeps "Ring: 10 · Bangle: 2.4" in one string); any other category takes the size as typed.
    @ViewBuilder
    private var sizeSection: some View {
        if let scale = NewOrderSizes.scale(for: f.categoryId) {
            Section {
                if scale.multi {
                    ForEach(scale.parts) { part in
                        NewOrderSizeField(title: part.label, options: part.options, value: partBinding(scale, part))
                    }
                } else if let only = scale.parts.first {
                    NewOrderSizeField(title: "Size", options: only.options, value: $f.size)
                }
            } header: {
                Text("Size")
            } footer: {
                Text(scale.multi ? scale.label + ". Leave either blank if not applicable." : scale.label)
            }
        } else {
            Section("Size") {
                TextField("Size", text: $f.size, prompt: Text("Optional"))
            }
        }
    }

    private func partBinding(_ scale: NewOrderSizes.Scale, _ part: NewOrderSizes.Part) -> Binding<String> {
        Binding(
            get: { NewOrderSizes.parse(f.size, legacyKey: scale.legacyPartKey)[part.key] ?? "" },
            set: { typed in
                var parsed = NewOrderSizes.parse(f.size, legacyKey: scale.legacyPartKey)
                parsed[part.key] = typed
                f.size = NewOrderSizes.compose(parsed, order: scale.parts.map { $0.key })
            }
        )
    }

    private var finishSection: some View {
        Section("925 Sterling Silver finish") {
            Picker("Plating", selection: $f.platingType) {
                Text("No plating").tag("")
                ForEach(SalePlating.all, id: \.self) { p in Text(p).tag(p) }
            }
            if f.platingType == "Other" {
                TextField("Describe the plating", text: $f.platingNote, prompt: Text("e.g. Rose gold plating"))
            }
            Toggle("Nickel free", isOn: $f.nickelFree)
        }
    }

    private var priceSection: some View {
        Section {
            Picker("How it is priced", selection: $f.fixed) {
                Text("Weight × rate").tag(false)
                Text("Fixed price").tag(true)
            }
            .pickerStyle(.segmented)
            if f.fixed {
                SaleNumberField(label: "Price (PKR)", text: $f.customPrice, prompt: "The agreed total")
                // A fixed price still has a weight, and the bill says it (owner, 2026-10-07): it moves nothing,
                // but it prints, and the margin is costed from it instead of the 10% guess.
                SaleNumberField(label: "Weight (g)", text: $f.weight, prompt: "Optional")
                if silver {
                    SaleNumberField(label: "Reference rate per gram", text: $f.silverRate, prompt: "Optional")
                }
            } else {
                SaleNumberField(label: "Weight (g)", text: $f.weight)
                if silver {
                    SaleNumberField(label: "Rate per gram (PKR)", text: $f.silverRate, prompt: "e.g. 150")
                } else {
                    SaleNumberField(label: "Wastage (%)", text: $f.wastage)
                }
                SaleNumberField(label: "Making (PKR)", text: $f.making)
                SaleNumberField(label: "Stones (PKR)", text: $f.stoneCharges)
                SaleNumberField(label: "Misc (PKR)", text: $f.miscCharges)
                if silver { SaleNumberField(label: "Wastage (%)", text: $f.wastage) }
            }
        } header: {
            Text("Price")
        } footer: {
            if f.fixed {
                Text("The weight is printed on the bill; the price stays as typed.")
            }
        }
    }

    private var stonesSection: some View {
        Section("Diamonds and stones") {
            Toggle("Has diamonds", isOn: $f.hasDiamonds)
            if f.hasDiamonds {
                // The charge only exists when the price is built from the rate; the details print either way.
                if !f.fixed { SaleNumberField(label: "Diamonds (PKR)", text: $f.diamondCharges) }
                TextField("Diamond details", text: $f.diamondDetails, prompt: Text("e.g. 0.5ct round"))
            }
            Toggle("Has other stones", isOn: $f.hasStones)
            if f.hasStones {
                SaleNumberField(label: "Stone weight (g)", text: $f.stoneWeight)
                TextField("Stone details", text: $f.stoneDetails, prompt: Text("e.g. 4 rubies"))
            }
        }
    }

    private var billSection: some View {
        Section {
            TextField("Description", text: $f.billDescription, prompt: Text("Additional details to appear on the invoice"), axis: .vertical)
                .lineLimit(2...5)
        } header: {
            Text("On the bill")
        }
    }

    private var totalSection: some View {
        Section {
            LabeledContent("Line total") {
                Text(Money.pkr(preview))
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: preview))
            }
        } footer: {
            Text(create ? "This piece is on this sale only." : "These changes apply to this sale only, not to the piece in stock.")
        }
    }
}
