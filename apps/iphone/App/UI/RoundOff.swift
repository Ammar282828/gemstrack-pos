import SwiftUI
import ERPCore

/// The round-off offers under a discount field (owner, 2026-10-17: "automatically offer discount options to round
/// the bill for any amount under 5000"), as components/shared/round-off-chips.tsx shows them: up to three small
/// capsules, "Round to 270,000 · −2,340". The rule is ERPCore's (MoneyRound.swift, lib/money-round.ts); this is only
/// the chips.
///
/// `payable` is what the bill comes to before any discount (the pieces less the exchange). The chips work from what
/// is left after the discount already typed. Tapping one adds its extra to that discount; tapping the lit one puts the
/// discount back as it was. Typing in the discount field afterwards simply stops it being lit.
///
/// Bordered, not glass: they sit under a field in a form, and a glass button under an animated swap blobs.
struct RoundOffChips: View {
    let payable: Double
    /// The discount as typed, any text already read to a number.
    let discount: Double
    /// Receives the bill's whole discount once a chip is tapped (or undone).
    let onDiscountChange: (Double) -> Void

    /// The discount before the tap, and the total the tap made: lit while the bill still comes to it.
    private struct Applied: Equatable {
        let base: Double
        let target: Double
    }
    @State private var applied: Applied?

    var body: some View {
        let disc = rupees(discount)
        let whole = rupees(payable)
        let lit = applied.flatMap { whole - disc == $0.target ? $0 : nil }
        let base = lit?.base ?? disc
        let offers = roundOffOffers(whole, base)
        if !offers.isEmpty {
            ArtworkFlow(spacing: pt(6)) {
                ForEach(offers, id: \.target) { o in
                    let chosen = lit?.target == o.target
                    Button {
                        if chosen {
                            applied = nil
                            onDiscountChange(base)
                        } else {
                            applied = Applied(base: base, target: o.target)
                            onDiscountChange(discountWithOffer(base, o))
                        }
                    } label: {
                        HStack(spacing: pt(4)) {
                            if chosen { Image(systemName: "checkmark") }
                            Text(roundOffLabel(o)).monospacedDigit()
                        }
                        .font(.caption.weight(chosen ? .semibold : .regular))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
                    .tint(Theme.accent)
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Round the bill off")
            .sensoryFeedback(.selection, trigger: applied)
        }
    }
}

/// "Settle — give the remaining PKR 2,340 off" (round-off-chips.tsx SettleOffer): the words of the offer made at
/// payment time when what would be left is under 5,000.
enum SettleWords {
    static func offer(_ x: Double) -> String { "Settle — give the remaining \(pkr(x)) off" }
}
