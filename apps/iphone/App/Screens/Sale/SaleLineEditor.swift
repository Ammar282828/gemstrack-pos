import SwiftUI
import ERPCore

/// Every attribute of a line on the sale, not only its price (components/cart/edit-cart-item-dialog.tsx):
/// the name, category, size, metal, weights, plating, and each charge. The line total at the foot is
/// worked out by the same `calculateProductCosts` the sale uses, so what is shown here is what the
/// invoice will say. Changes are for this sale only; the piece in stock is untouched.
///
/// Unlike the web, a palladium piece keeps its karat when edited (the web's patch drops it for any
/// metal but gold, which would price an 18k palladium piece at the flat rate).
struct SaleLineEditor: View {
    let line: SaleLine
    let rates: PricingRates
    let apply: (SaleLine) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var f: Fields

    init(line: SaleLine, rates: PricingRates, apply: @escaping (SaleLine) -> Void) {
        self.line = line
        self.rates = rates
        self.apply = apply
        _f = State(initialValue: Fields(line))
    }

    /// Everything the sheet edits, held as text so the fields stay editable (the web's `Draft`).
    struct Fields {
        var name: String
        var categoryId: String
        var size: String
        var metalType: String
        var karat: String
        var weight: String
        var hasStones: Bool
        var stoneWeight: String
        var wastage: String
        var making: String
        var hasDiamonds: Bool
        var diamondCharges: String
        var stoneCharges: String
        var miscCharges: String
        var stoneDetails: String
        var diamondDetails: String
        var billDescription: String
        var platingType: String
        var platingNote: String
        var nickelFree: Bool
        var silverRate: String
        var fixed: Bool
        var customPrice: String

        init(_ l: SaleLine) {
            name = l.name
            categoryId = l.categoryId
            size = l.size ?? ""
            metalType = l.metalType
            karat = l.karat ?? ""
            weight = SaleNumber.text(l.metalWeightG)
            // The reveal opens whenever there is stone or diamond data to show, so a figure that is in
            // the price can never sit behind a closed switch.
            hasStones = l.hasStones || l.stoneWeightG > 0 || !(l.stoneDetails ?? "").isEmpty
            stoneWeight = SaleNumber.text(l.stoneWeightG)
            wastage = SaleNumber.text(l.wastagePercentage)
            making = SaleNumber.text(l.makingCharges)
            hasDiamonds = l.hasDiamonds || l.diamondCharges > 0 || !(l.diamondDetails ?? "").isEmpty
            diamondCharges = SaleNumber.text(l.diamondCharges)
            stoneCharges = SaleNumber.text(l.stoneCharges)
            miscCharges = SaleNumber.text(l.miscCharges)
            stoneDetails = l.stoneDetails ?? ""
            diamondDetails = l.diamondDetails ?? ""
            billDescription = l.billDescription ?? ""
            platingType = l.platingType ?? ""
            platingNote = l.platingNote ?? ""
            nickelFree = l.nickelFree
            silverRate = SaleNumber.text(l.silverRatePerGram)
            fixed = l.isCustomPrice
            customPrice = SaleNumber.text(l.customPrice)
        }

        private func nilIfBlank(_ s: String) -> String? {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? nil : t
        }

        /// The line with these edits (the web's `toPatch`).
        func applied(to base: SaleLine) -> SaleLine {
            var out = base
            let silver = metalType == "silver"
            out.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
            out.categoryId = categoryId
            out.size = nilIfBlank(size)
            out.metalType = metalType
            // Karat only means something where the metal has one: a stray "21k" on silver is the
            // phantom karat that used to print on 925 pieces.
            out.karat = metalHasKarat(metalType) && !karat.isEmpty ? karat : nil
            out.metalWeightG = SaleNumber.value(weight)
            out.hasStones = hasStones
            out.stoneWeightG = SaleNumber.value(stoneWeight)
            out.wastagePercentage = SaleNumber.value(wastage)
            out.makingCharges = SaleNumber.value(making)
            out.hasDiamonds = hasDiamonds
            out.diamondCharges = SaleNumber.value(diamondCharges)
            out.stoneCharges = SaleNumber.value(stoneCharges)
            out.miscCharges = SaleNumber.value(miscCharges)
            out.stoneDetails = nilIfBlank(stoneDetails)
            out.diamondDetails = nilIfBlank(diamondDetails)
            out.billDescription = nilIfBlank(billDescription)
            out.platingType = silver && !platingType.isEmpty ? platingType : nil
            out.platingNote = silver && platingType == "Other" ? nilIfBlank(platingNote) : nil
            out.nickelFree = silver ? nickelFree : false
            let rate = SaleNumber.value(silverRate)
            out.silverRatePerGram = silver && rate > 0 ? rate : nil
            out.isCustomPrice = fixed
            out.customPrice = fixed ? SaleNumber.value(customPrice) : nil
            return out
        }
    }

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
            Form {
                pieceSection
                if silver { finishSection }
                priceSection
                stonesSection
                billSection
                totalSection
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(line.isOneOff ? "Edit piece" : line.sku)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        apply(f.applied(to: line))
                        dismiss()
                    }
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
        Section("The piece") {
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
            TextField("Size", text: $f.size, prompt: Text("Optional, e.g. 10 Indian / 5 US"))
        }
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
            Text("These changes apply to this sale only, not to the piece in stock.")
        }
    }
}
