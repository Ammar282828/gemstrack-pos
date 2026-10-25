#if os(macOS)
import SwiftUI
import ERPCore

// Two controls of the Orders documents (docs/features/mac-design.md, rule 7 and "Make invoice"): the document's footer,
// with its one action on a key of its own (never Return, which the fields may take), and the discount's Round menu.

/// A document window's footer: what stands in the way, or what the balance is, on the left; the one action on the right,
/// named with what it does ("Make Invoice · PKR 125,000") and bound to a key (⌘S). It is not the default button: Return
/// in a field never fires it.
struct MacOrdersFooter: View {
    /// The balance, or what blocks the action.
    let summary: String
    var summaryTone: Tone = .quiet
    let title: String
    var busy = false
    var enabled = true
    var shortcut = KeyboardShortcut("s", modifiers: .command)
    let action: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                Text(summary)
                    .font(.callout)
                    .foregroundStyle(summaryTone == .quiet ? Color.secondary : summaryTone.color)
                    .monospacedDigit()
                    .lineLimit(2)
                Spacer(minLength: 12)
                Button(action: action) {
                    HStack(spacing: 6) {
                        if busy { ProgressView().controlSize(.small) }
                        Text(title)
                    }
                    .frame(minWidth: 72)
                }
                .keyboardShortcut(shortcut)
                .buttonStyle(.borderedProminent)
                .disabled(!enabled || busy)
                .help(title + " (" + MacAction.describe(shortcut) + ")")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(.bar)
    }
}

/// The round-off offers under a discount, as a menu (the chips' Mac form): "Round to 270,000 · −2,340". The rule is
/// ERPCore's (`roundOffOffers`); picking one adds its extra to the discount, picking the ticked one puts the discount back
/// as it was.
struct MacOrdersRoundMenu: View {
    /// What the bill comes to before any discount (the pieces less the exchange).
    let payable: Double
    /// The discount as typed, read to a number.
    let discount: Double
    /// Receives the bill's whole discount once an offer is taken (or undone).
    let onDiscountChange: (Double) -> Void

    /// The discount before the pick, and the total the pick made: ticked while the bill still comes to it.
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
        Menu("Round") {
            ForEach(offers, id: \.target) { (o: RoundOffOffer) in
                Button {
                    if lit?.target == o.target {
                        applied = nil
                        onDiscountChange(base)
                    } else {
                        applied = Applied(base: base, target: o.target)
                        onDiscountChange(discountWithOffer(base, o))
                    }
                } label: {
                    if lit?.target == o.target {
                        Label(roundOffLabel(o), systemImage: "checkmark")
                    } else {
                        Text(roundOffLabel(o))
                    }
                }
            }
        }
        .disabled(offers.isEmpty)
        .help("Give the bill a round number: the extra is added to the discount")
    }
}
#endif
