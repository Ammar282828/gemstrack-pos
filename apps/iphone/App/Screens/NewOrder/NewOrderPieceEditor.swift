import SwiftUI
import ERPCore

/// What identifies the piece being edited (the editor is pushed on the form's own stack).
struct NewOrderPieceRef: Hashable, Identifiable {
    let id: UUID
}

/// One row of the form's list of pieces: what it is, what it is made of, and what it comes to.
struct NewOrderPieceRow: View {
    let piece: NewOrderPieceDraft
    let number: Int
    let price: Double

    private var title: String { NewOrderFormat.trim(piece.description) }

    /// "Gold (21K) · 5.2 g · 10" (components/order/order-form.tsx `spec`).
    private var spec: String {
        var parts: [String] = []
        let metal = describeMetal(piece.metal, piece.karat)
        if !metal.isEmpty { parts.append(metal) }
        let weight = NewOrderFormat.num(piece.weight)
        if !piece.manual && weight > 0 { parts.append(NewOrderFormat.trimmed(weight) + " g") }
        let size = NewOrderFormat.trim(piece.size)
        if !size.isEmpty { parts.append(size) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 10) {
            Text("#\(number)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(title.isEmpty ? "Untitled piece" : title)
                    .foregroundStyle(title.isEmpty ? Color.secondary : Color.primary)
                    .lineLimit(1)
                if !spec.isEmpty {
                    Text(spec)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if price > 0 {
                Text(Money.pkr(price))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            Image(systemName: "chevron.right")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
    }
}

/// One piece, in full (order-form.tsx's open item): what it is, what it costs, what the bench needs, and
/// what it was copied from. Every field the web has, under the same names and the same rules.
struct NewOrderPieceEditor: View {
    @Binding var piece: NewOrderPieceDraft
    let number: Int
    let rates: PricingRates
    let karigars: [Karigar]
    let onDuplicate: () -> Void
    let onRemove: () -> Void
    var editingOrder = false

    @Environment(\.dismiss) private var dismiss
    @State private var confirmRemove = false

    private var metal: MetalType { MetalType(rawValue: piece.metal) }
    private var silver: Bool { metal == .silver }

    var body: some View {
        Form { Group {
            thePiece
            sizeBox
            priceBox
            workshopBox
            referencesBox
            totalBox
            actionsBox
            }
            .houseRows()
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Piece \(number)")
        .navigationBarTitleDisplayMode(.inline)
        .newOrderKeyboardDone()
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save product") { dismiss() }
            }
        }
        .confirmationDialog("Remove this piece?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove piece", role: .destructive) {
                onRemove()
                dismiss()
            }
            Button("Keep it", role: .cancel) {}
        }
    }

    // MARK: The piece

    private var thePiece: some View {
        LedgerSection("The piece") {
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
            VStack(alignment: .leading, spacing: 6) {
                Text("Karat").font(.caption).foregroundStyle(.secondary)
                Picker("Karat", selection: $piece.karat) {
                    ForEach(karats, id: \.rawValue) { k in
                        Text(k.rawValue.uppercased()).tag(k.rawValue)
                    }
                }
                .pickerStyle(.segmented)
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
                LedgerHeading(title: "Size")
            } footer: {
                Text(scale.multi ? scale.label + ". Leave either blank if not applicable." : scale.label)
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
                Text("Weight × rate").tag(false)
                Text("Fixed price").tag(true)
            }
            .pickerStyle(.segmented)
            if piece.manual {
                NewOrderNumberRow(title: "Price (PKR)", text: $piece.manualPrice, prompt: "The agreed total")
            } else {
                weighedRows
            }
        } header: {
            LedgerHeading(title: "Price")
        } footer: {
            if !piece.manual {
                Text("Weight is with the stones in; the stones' weight comes off the metal.")
            }
        }
    }

    /// Weight and wastage together: the two numbers the metal price is made from. Silver's rate already
    /// holds its making and wastage, so silver asks for neither (decisions.md "Order to invoice").
    @ViewBuilder
    private var weighedRows: some View {
        NewOrderNumberRow(title: "Weight", text: $piece.weight, unit: "g")
        if takesWastageAndMaking(metal) {
            NewOrderWastageRow(
                percent: $piece.wastage,
                weight: piece.weightValue,
                stoneWeight: piece.stoneWeightValue
            )
            NewOrderNumberRow(title: "Making (PKR)", text: $piece.making)
        }
        NewOrderNumberRow(title: "Stones (PKR)", text: $piece.stones)
        diamondRows
        stoneRows
    }

    @ViewBuilder
    private var diamondRows: some View {
        Toggle("Has diamonds", isOn: $piece.hasDiamonds)
        if piece.hasDiamonds {
            NewOrderNumberRow(title: "Diamonds (PKR)", text: $piece.diamond)
            TextField("Diamond details", text: $piece.diamondDetails, prompt: Text("e.g. Centre 1ct VVS1, sides 12 × 0.05ct VS2"), axis: .vertical)
                .lineLimit(2...4)
        }
    }

    @ViewBuilder
    private var stoneRows: some View {
        Toggle("Has other stones", isOn: $piece.hasStones)
        if piece.hasStones {
            NewOrderNumberRow(title: "Stone weight", text: $piece.stoneWeight, prompt: "e.g. 0.5", unit: "g")
            TextField("Stone details", text: $piece.stoneDetails, prompt: Text("e.g. 1 × ruby 2ct, 4 × sapphire 0.5ct"), axis: .vertical)
                .lineLimit(2...4)
        }
    }

    // MARK: The workshop

    private var workshopBox: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Label("Instructions for the karigar", systemImage: "lock.fill")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
                TextField("Instructions", text: $piece.adminNote, prompt: Text("Stones, plating, sizing, or other specifications"), axis: .vertical)
                    .lineLimit(2...6)
            }
            Picker("Karigar", selection: $piece.karigarId) {
                Text("No karigar yet").tag("")
                ForEach(karigars) { k in
                    Text(k.name).tag(k.id)
                }
            }
            if editingOrder { Toggle("Piece is finished", isOn: $piece.isCompleted) }
        } header: {
            LedgerHeading(title: "For the workshop")
        } footer: {
            Text("The instructions are never printed on a customer estimate or invoice.")
        }
    }

    // MARK: References

    private var referencesBox: some View {
        Section {
            NewOrderSampleField(piece: $piece)
            TextField("Reference SKU", text: $piece.referenceSku, prompt: Text("e.g. RIN-123456"))
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            Toggle("Customer provided a physical sample", isOn: $piece.sampleGiven)
        } header: {
            LedgerHeading(title: "References")
        } footer: {
            Text("All optional.")
        }
    }

    // MARK: Total

    private var totalBox: some View {
        Section {
            LabeledContent("This piece") {
                Text(Money.pkr(NewOrderMath.price(piece, rates)))
                    .fontWeight(.semibold)
                    .monospacedDigit()
            }
        }
    }

    private var actionsBox: some View {
        Section {
            Button {
                onDuplicate()
                dismiss()
            } label: {
                Label("Duplicate this piece", systemImage: "plus.square.on.square")
            }
            Button(role: .destructive) {
                confirmRemove = true
            } label: {
                Label("Remove this piece", systemImage: "trash")
            }
        }
    }
}

/// Wastage, one figure two ways (decisions.md "Order to invoice"): the percentage, and the grams it stands
/// for on the metal less its stones. Either can be typed; the percentage is what the order keeps (the
/// workshop slip keeps the percentage, and the invoice prints the grams).
struct NewOrderWastageRow: View {
    @Binding var percent: String
    let weight: Double
    let stoneWeight: Double

    @State private var gramsText = ""
    @FocusState private var gramsFocused: Bool

    /// The grams the percentage stands for now.
    private var grams: Double {
        wastageGramsFor(NewOrderFormat.num(percent), weight, stoneWeight)
    }

    private var gramsWords: String {
        NewOrderFormat.boxText(grams, digits: 3)
    }

    // Two rows; the handlers sit on the grams row alone, so each runs once.
    var body: some View {
        LabeledContent("Wastage (%)") {
            TextField("Wastage", text: $percent, prompt: Text("0"))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
        }
        LabeledContent("Wastage (grams)") {
            TextField("Wastage in grams", text: $gramsText, prompt: Text(weight > 0 ? "0" : "Weigh it first"))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                .focused($gramsFocused)
        }
        .onAppear { gramsText = gramsWords }
        // Typing the percentage (or the weight) refreshes the grams, unless the grams are what is being typed.
        .onChange(of: grams) { _, _ in
            if !gramsFocused { gramsText = gramsWords }
        }
        .onChange(of: gramsText) { _, typed in
            guard gramsFocused else { return }
            percent = NewOrderMath.wastageText(grams: typed, weight: weight, stoneWeight: stoneWeight)
        }
    }
}
