#if os(macOS)
import SwiftUI
import ERPCore

// New order, the right panel's Piece tab (docs/features/mac-design.md, "New order"): the piece picked in the table, edited
// in place. Every field of the phone's NewOrderPieceEditor, on the same bindings of the same `NewOrderPieceDraft`, so what
// is saved is what the phone saves; only the arrangement is a Mac form's, in plain section headers and pop-up menus.

struct MacNewOrderPieceForm: View {
    @Binding var piece: NewOrderPieceDraft
    let number: Int
    let rates: PricingRates
    let karigars: [Karigar]
    /// Edit order: a piece can be marked finished.
    let editingOrder: Bool

    private var metal: MetalType { MetalType(rawValue: piece.metal) }
    private var silver: Bool { metal == .silver }

    var body: some View {
        Form {
            thePiece
            sizeBox
            priceBox
            workshopBox
            referencesBox
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Theme.ground)
    }

    // MARK: The piece

    private var thePiece: some View {
        Section {
            Picker("Category", selection: $piece.category) {
                Text("None").tag("")
                ForEach(NewOrderWords.categories) { c in
                    Text(c.label).tag(c.id)
                }
            }
            TextField("Description", text: $piece.description, prompt: Text("e.g. Custom ring with ruby stone"), axis: .vertical)
                .lineLimit(2...5)
            Picker("Metal", selection: metalBinding) {
                ForEach(METAL_TYPES, id: \.rawValue) { m in
                    Text(metalLabel(m)).tag(m.rawValue)
                }
            }
            karatPicker
            silverFinish
            LabeledContent("This piece") {
                Text(Money.pkr(NewOrderMath.price(piece, rates))).monospacedDigit().fontWeight(.semibold)
            }
        } header: {
            Text("Piece \(number)")
        }
    }

    private var metalBinding: Binding<String> {
        Binding(
            get: { piece.metal },
            set: { next in piece.setMetal(next) }
        )
    }

    @ViewBuilder
    private var karatPicker: some View {
        let karats = karatsFor(metal)
        if !karats.isEmpty {
            Picker("Karat", selection: $piece.karat) {
                ForEach(karats, id: \.rawValue) { k in
                    Text(k.rawValue.uppercased()).tag(k.rawValue)
                }
            }
        }
    }

    /// 925 sterling silver's finish: plating, and whether it is nickel free.
    @ViewBuilder
    private var silverFinish: some View {
        if silver {
            Picker("Plating", selection: $piece.platingType) {
                Text("No plating").tag("")
                ForEach(NewOrderWords.platings, id: \.self) { p in
                    Text(p).tag(p)
                }
            }
            if piece.platingType == "Other" {
                TextField("Describe the plating", text: $piece.platingNote, prompt: Text("e.g. Rose gold plating"))
            }
            Toggle("Nickel free", isOn: $piece.nickelFree)
        }
    }

    // MARK: Size

    @ViewBuilder
    private var sizeBox: some View {
        if let scale = NewOrderSizes.scale(for: piece.category) {
            Section {
                if scale.multi {
                    ForEach(scale.parts) { part in
                        NewOrderSizeField(title: part.label, options: part.options, value: partBinding(scale, part))
                    }
                } else if let only = scale.parts.first {
                    NewOrderSizeField(title: "Size", options: only.options, value: $piece.size)
                }
            } header: {
                Text("Size")
            } footer: {
                Text(scale.label)
            }
        }
    }

    private func partBinding(_ scale: NewOrderSizes.Scale, _ part: NewOrderSizes.Part) -> Binding<String> {
        Binding(
            get: { NewOrderSizes.parse(piece.size, legacyKey: scale.legacyPartKey)[part.key] ?? "" },
            set: { typed in
                var parsed = NewOrderSizes.parse(piece.size, legacyKey: scale.legacyPartKey)
                parsed[part.key] = typed
                piece.size = NewOrderSizes.compose(parsed, order: scale.parts.map { $0.key })
            }
        )
    }

    // MARK: Price

    private var priceBox: some View {
        Section {
            Picker("How it is priced", selection: $piece.manual) {
                Text("Weight \u{00D7} Rate").tag(false)
                Text("Fixed Price").tag(true)
            }
            if piece.manual {
                NewOrderNumberRow(title: "Price (PKR)", text: $piece.manualPrice, prompt: "The agreed total", rupees: true)
            } else {
                weighedRows
            }
        } header: {
            Text("Price")
        } footer: {
            if !piece.manual {
                Text("Weight is with the stones in; the stones' weight comes off the metal.")
            }
        }
    }

    /// Weight and wastage together: the two numbers the metal price is made from. Silver's rate already holds its making and
    /// wastage, so silver asks for neither (decisions.md "Order to invoice").
    @ViewBuilder
    private var weighedRows: some View {
        NewOrderNumberRow(title: "Weight", text: $piece.weight, unit: "g")
        if takesWastageAndMaking(metal) {
            NewOrderWastageRow(
                percent: $piece.wastage,
                weight: piece.weightValue,
                stoneWeight: piece.stoneWeightValue
            )
            NewOrderNumberRow(title: "Making (PKR)", text: $piece.making, rupees: true)
        }
        NewOrderNumberRow(title: "Stones (PKR)", text: $piece.stones, rupees: true)
        diamondRows
        stoneRows
    }

    @ViewBuilder
    private var diamondRows: some View {
        Toggle("Has diamonds", isOn: $piece.hasDiamonds)
        if piece.hasDiamonds {
            NewOrderNumberRow(title: "Diamonds (PKR)", text: $piece.diamond, rupees: true)
            TextField("Diamond details", text: $piece.diamondDetails, prompt: Text("e.g. Centre 1ct VVS1, sides 12 \u{00D7} 0.05ct VS2"), axis: .vertical)
                .lineLimit(2...4)
        }
    }

    @ViewBuilder
    private var stoneRows: some View {
        Toggle("Has other stones", isOn: $piece.hasStones)
        if piece.hasStones {
            NewOrderNumberRow(title: "Stone weight", text: $piece.stoneWeight, prompt: "e.g. 0.5", unit: "g")
            TextField("Stone details", text: $piece.stoneDetails, prompt: Text("e.g. 1 \u{00D7} ruby 2ct, 4 \u{00D7} sapphire 0.5ct"), axis: .vertical)
                .lineLimit(2...4)
        }
    }

    // MARK: The workshop

    private var workshopBox: some View {
        Section {
            TextField("Instructions for the karigar", text: $piece.adminNote, prompt: Text("Stones, plating, sizing, or other specifications"), axis: .vertical)
                .lineLimit(2...6)
            Picker("Karigar", selection: $piece.karigarId) {
                Text("No karigar yet").tag("")
                ForEach(karigars) { k in
                    Text(k.name).tag(k.id)
                }
            }
            if editingOrder { Toggle("Piece is finished", isOn: $piece.isCompleted) }
        } header: {
            Text("For the Workshop")
        } footer: {
            Text("The instructions are never printed on a customer estimate or invoice.")
        }
    }

    // MARK: References

    private var referencesBox: some View {
        Section {
            NewOrderSampleField(piece: $piece)
            TextField("Reference SKU", text: $piece.referenceSku, prompt: Text("e.g. RIN-123456"))
                .autocorrectionDisabled()
            Toggle("Customer provided a physical sample", isOn: $piece.sampleGiven)
        } header: {
            Text("References")
        }
    }
}
#endif
