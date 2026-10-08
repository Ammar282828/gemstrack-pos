import SwiftUI
import ERPCore

/// One piece of an order, as the bench and the counter both need it (src/app/orders/[id]/page.tsx):
/// what it is, every specification the order captured, who has it and whether it has left the shop,
/// the instructions for the karigar, and its price. The tick is the web's "Mark as Complete".
struct OrderPieceRow: View {
    let index: Int
    let item: OrderItem
    /// The karigar's name; nil when none is picked.
    let karigar: String?
    /// Owners tick pieces off, until the order is invoiced.
    let canTick: Bool
    let busy: Bool
    /// The price broken into metal, wastage, making, diamonds and stones: owners only.
    let showBreakdown: Bool
    let onTick: (Bool) -> Void

    @State private var priceOpen = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                heading
                factList
                karigarLine
                notes
                price
            }
            Spacer(minLength: 0)
            tick
        }
        .padding(.vertical, 4)
    }

    // MARK: What it is

    private var heading: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let category = OrdersLogic.categorySingular(item.itemCategory) {
                Text(category.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text(item.description.isEmpty ? "Piece \(index + 1)" : item.description)
                .font(.headline)
                .strikethrough(item.isCompleted)
        }
    }

    private struct Fact: Identifiable {
        let label: String
        let value: String
        var id: String { label }
    }

    private var facts: [Fact] {
        var rows: [Fact] = []
        let metal = describeMetal(item.metalType, item.karat)
        if !metal.isEmpty { rows.append(Fact(label: "Metal", value: metal)) }
        if !item.isManualPrice && item.estimatedWeightG > 0 {
            rows.append(Fact(label: "Est. weight", value: OrdersLogic.grams(item.estimatedWeightG)))
            if item.metalType != .silver && item.wastagePercentage > 0 {
                rows.append(Fact(label: "Wastage", value: OrdersLogic.number(item.wastagePercentage, maxDigits: 2) + "%"))
            }
        }
        if let size = item.size, !size.isEmpty { rows.append(Fact(label: "Size", value: size)) }
        if let finish = describePlating(item) { rows.append(Fact(label: "Finish", value: finish)) }
        if item.stoneWeightG > 0 { rows.append(Fact(label: "Stone weight", value: OrdersLogic.grams(item.stoneWeightG))) }
        if let sku = item.referenceSku, !sku.isEmpty { rows.append(Fact(label: "Ref SKU", value: sku)) }
        if item.sampleGiven { rows.append(Fact(label: "Sample", value: "Provided by customer")) }
        if item.isManualPrice {
            rows.append(Fact(label: "Price", value: Money.pkr(item.manualPrice ?? item.totalEstimate ?? 0)))
        }
        return rows
    }

    private var factList: some View {
        VStack(spacing: 2) {
            ForEach(facts) { f in
                HStack(alignment: .firstTextBaseline) {
                    Text(f.label).foregroundStyle(.secondary)
                    Spacer(minLength: 12)
                    Text(f.value).multilineTextAlignment(.trailing)
                }
                .font(.subheadline)
            }
        }
    }

    // MARK: Who has it

    private var givenWords: String {
        if let given = item.givenAt, !given.isEmpty { return "given " + ShopDate.say(given) }
        return "not given yet"
    }

    private var karigarLine: some View {
        HStack(spacing: 6) {
            Image(systemName: "hammer").foregroundStyle(.secondary)
            if let karigar {
                Text(karigar).fontWeight(.medium)
                Text("· " + givenWords)
                    .foregroundStyle(item.givenAt == nil ? Color.orange : Color.secondary)
            } else {
                Text("No karigar yet").foregroundStyle(.orange)
            }
        }
        .font(.subheadline)
    }

    // MARK: Stones, diamonds and the instructions

    @ViewBuilder
    private var notes: some View {
        if let d = clean(item.diamondDetails) {
            noteBox("Diamonds", d, symbol: "diamond", tint: .secondary)
        }
        if let s = clean(item.stoneDetails) {
            noteBox("Stones", s, symbol: "sparkles", tint: .secondary)
        }
        // Owners only: the staff's copy of the order comes without it (roles.ts).
        if let a = clean(item.adminNote) {
            noteBox("Instructions for the karigar (never printed)", a, symbol: "lock.fill", tint: .orange)
        }
    }

    private func clean(_ s: String?) -> String? {
        let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func noteBox(_ title: String, _ text: String, symbol: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: symbol)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Color.secondary.opacity(0.12), in: .rect(cornerRadius: 8))
    }

    // MARK: Price, last: subordinate to what the piece is

    @ViewBuilder
    private var price: some View {
        if let total = item.totalEstimate {
            if showBreakdown && !item.isManualPrice {
                Button {
                    priceOpen.toggle()
                } label: {
                    HStack {
                        Text("Item total").foregroundStyle(.secondary)
                        Spacer()
                        Text(Money.pkr(total)).fontWeight(.semibold).monospacedDigit()
                        Image(systemName: priceOpen ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .font(.subheadline)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.primary)
                if priceOpen { breakdown }
            } else {
                HStack {
                    Text("Item total").foregroundStyle(.secondary)
                    Spacer()
                    Text(Money.pkr(total)).fontWeight(.semibold).monospacedDigit()
                }
                .font(.subheadline)
            }
        }
    }

    private var breakdown: some View {
        VStack(spacing: 2) {
            line("Metal", item.metalCost ?? 0, always: true)
            line("Wastage", item.wastageCost ?? 0)
            line("Making", item.makingCharges)
            line("Diamonds", item.diamondCharges)
            line("Stones", item.stoneCharges)
        }
        .font(.caption)
    }

    @ViewBuilder
    private func line(_ label: String, _ amount: Double, always: Bool = false) -> some View {
        if always || amount > 0 {
            HStack {
                Text(label).foregroundStyle(.secondary)
                Spacer()
                Text(Money.pkr(amount)).monospacedDigit()
            }
        }
    }

    // MARK: Done

    @ViewBuilder
    private var tick: some View {
        if busy {
            ProgressView()
        } else if canTick {
            Button {
                onTick(!item.isCompleted)
            } label: {
                Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(item.isCompleted ? Color.green : Color.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(item.isCompleted ? "Done. Tap to mark not done." : "Mark as complete")
        } else if item.isCompleted {
            Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(.green)
                .accessibilityLabel("Done")
        }
    }
}
