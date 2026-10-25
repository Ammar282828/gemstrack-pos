#if os(macOS)
import SwiftUI
import ERPCore

// New order, the right panel and the footer (docs/features/mac-design.md, "New order"). The panel is switched by a segmented
// control in its own header: Piece (the piece picked in the table) or Order (rates, payment, exchange, delivery, notes). The
// footer holds the balance and the order's one Save.

enum MacNewOrderPanelTab: Hashable {
    case piece, order
}

struct MacNewOrderPanel<PieceContent: View, OrderContent: View>: View {
    @Binding var tab: MacNewOrderPanelTab
    @ViewBuilder let piece: () -> PieceContent
    @ViewBuilder let order: () -> OrderContent

    var body: some View {
        VStack(spacing: 0) {
            Picker("Panel", selection: $tab) {
                Text("Piece").tag(MacNewOrderPanelTab.piece)
                Text("Order").tag(MacNewOrderPanelTab.order)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            Divider()
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch tab {
        case .piece: piece()
        case .order: order()
        }
    }
}

/// The footer: what is still owed (or the credit) on the left, the order's one Save on the right.
struct MacNewOrderFooter: View {
    let summary: String
    let tone: Tone
    let busy: Bool
    let actions: [MacAction]

    var body: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 12) {
                Text(summary)
                    .font(.callout)
                    .foregroundStyle(tone == .quiet ? Color.secondary : tone.color)
                    .monospacedDigit()
                    .lineLimit(1)
                Spacer(minLength: 12)
                if busy { ProgressView().controlSize(.small) }
                MacActionButtons(actions: actions)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(.bar)
    }
}
#endif
