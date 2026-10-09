import SwiftUI
import ERPCore

/// One piece of an order, as the bench and the counter both need it (src/app/orders/[id]/page.tsx):
/// what it is, every specification the order captured (one line of facts, not a table), who has it and
/// whether it has left the shop, the instructions for the karigar, and its price. The tick is the web's
/// "Mark as Complete".
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
                factLine
                karigarLine
                notes
                price
            }
            Spacer(minLength: 0)
            tick
        }
        .padding(.vertical, 6)
    }

    // MARK: What it is

    private var heading: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let category = OrdersLogic.categorySingular(item.itemCategory) {
                Text(category.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(0.6)
                    .foregroundStyle(.secondary)
            }
            Text(item.description.isEmpty ? "Piece \(index + 1)" : item.description)
                .font(.headline)
                .foregroundStyle(item.isCompleted ? Color.secondary : Color.primary)
        }
        .accessibilityElement(children: .combine)
    }

    /// "21K Gold · Est. 12.5 g · 8% wastage · Size 14 · White Rhodium": what the order captured, in the order
    /// the bench reads it. The percentage stays here and on the slip; an invoice shows grams (decision
    /// "Wastage in grams").
    private var facts: [String] {
        var out: [String] = []
        let metal = describeMetal(item.metalType, item.karat)
        if !metal.isEmpty { out.append(metal) }
        if !item.isManualPrice && item.estimatedWeightG > 0 {
            out.append("Est. " + OrdersLogic.grams(item.estimatedWeightG))
            if item.metalType != .silver && item.wastagePercentage > 0 {
                out.append(OrdersLogic.number(item.wastagePercentage, maxDigits: 2) + "% wastage")
            }
        }
        if let size = item.size?.trimmingCharacters(in: .whitespacesAndNewlines), !size.isEmpty { out.append("Size " + size) }
        if let finish = describePlating(item) { out.append(finish) }
        if item.stoneWeightG > 0 { out.append("Stones " + OrdersLogic.grams(item.stoneWeightG)) }
        if let sku = item.referenceSku, !sku.isEmpty { out.append("Ref " + sku) }
        if item.sampleGiven { out.append("Sample from the customer") }
        if item.isManualPrice { out.append("Fixed at " + Money.pkr(item.manualPrice ?? item.totalEstimate ?? 0)) }
        return out
    }

    @ViewBuilder
    private var factLine: some View {
        let all = facts
        if !all.isEmpty {
            Text(all.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Who has it

    /// "given yesterday", "given Tue 6 Oct", or not yet: the gold leaving the shop is its own moment.
    private var givenWords: String {
        guard let given = item.givenAt, !given.isEmpty else { return "not given yet" }
        let said = ShopDate.say(given)
        return "given " + (["Today", "Yesterday", "Tomorrow"].contains(said) ? said.lowercased() : said)
    }

    /// Amber while nobody has it: work to hand out, not a promise missed. A finished piece with no karigar
    /// (made in the shop) says nothing.
    @ViewBuilder
    private var karigarLine: some View {
        if karigar != nil || !item.isCompleted {
            HStack(spacing: 6) {
                Image(systemName: "hammer")
                    .foregroundStyle(karigar == nil ? Tone.owed.color : Color.secondary)
                if let karigar {
                    Text(karigar).fontWeight(.medium)
                    Text("· " + givenWords)
                        .foregroundStyle(item.givenAt == nil ? Tone.owed.color : Color.secondary)
                } else {
                    Text("Not given out").foregroundStyle(Tone.owed.color)
                }
            }
            .font(.subheadline)
            .accessibilityElement(children: .combine)
        }
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
            noteBox("Instructions for the karigar (never printed)", a, symbol: "lock.fill", tint: Tone.owed.color)
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
                    .foregroundStyle(item.isCompleted ? Tone.settled.color : Color.secondary)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(item.isCompleted ? "Done. Tap to mark not done." : "Mark as complete")
        } else if item.isCompleted {
            Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(Tone.settled.color)
                .accessibilityLabel("Done")
        }
    }
}
