#if os(macOS)
import SwiftUI
import ERPCore

// The Mac's pieces for the Orders screens (apps/iphone/Mac/MAC-CONVENTIONS.md): the stage board of the iPhone hub's
// Mac layout, and the sheets a form opens in. An order's record window (its pieces and advances as tables) and the
// Orders place are in apps/iphone/Mac/Places/Orders/. The screens keep their own state and writes; nothing here decides
// anything, it only arranges what they hand it.

extension View {
    /// A Mac sheet at the size its content reads at (rule: forms 520-720 wide).
    func ordersMacSheet(width: CGFloat = 560, height: CGFloat = 440) -> some View {
        frame(minWidth: width, idealWidth: width, minHeight: height, idealHeight: height)
    }

    /// A sheet's one action in the Mac footer (what it will do on the right as the default button, Return; Esc cancels),
    /// or no footer while there is none.
    func macOrdersBar(_ primary: ActionBar.Action?) -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            if let primary { MacActionFooter(primary: primary) }
        }
    }
}

// MARK: The hub's board

/// One column of the board: a stage, with its orders.
struct OrdersBoardColumn: Identifiable {
    let id: String
    let title: String
    let hint: String
    let tone: Tone
    let folds: Bool
    let orders: [Order]
}

/// The Orders hub by stage on a Mac: a column for each stage side by side, each scrolling by itself, using the
/// window's width (and scrolling sideways when there are more columns than fit). Done and Closed fold away until
/// asked for, or until a search needs them.
struct OrdersStageBoard<Card: View>: View {
    let columns: [OrdersBoardColumn]
    @Binding var opened: Set<String>
    let forceOpen: Bool
    @ViewBuilder let card: (Order) -> Card

    var body: some View {
        GeometryReader { geometry in
            let count = max(columns.count, 1)
            let fit = (geometry.size.width - 40 - CGFloat(count - 1) * 16) / CGFloat(count)
            let columnWidth = min(max(fit, 290), 440)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(columns) { column in
                        VStack(alignment: .leading, spacing: 10) {
                            OrdersSectionHeader(
                                title: column.title,
                                hint: column.hint,
                                count: column.orders.count,
                                value: column.orders.reduce(0) { $0 + $1.subtotal },
                                tone: column.tone
                            )
                            if column.folds && !forceOpen && !opened.contains(column.id) {
                                Button("Show \(column.orders.count) order\(column.orders.count == 1 ? "" : "s")") {
                                    opened.insert(column.id)
                                }
                                .buttonStyle(.bordered)
                            } else {
                                ScrollView {
                                    LazyVStack(spacing: 14) {
                                        ForEach(column.orders) { order in card(order) }
                                    }
                                    .padding(.bottom, 20)
                                }
                                .scrollIndicators(.hidden)
                                if column.folds && !forceOpen {
                                    Button("Fold away") { opened.remove(column.id) }
                                        .buttonStyle(.borderless)
                                        .font(.footnote)
                                }
                            }
                        }
                        .frame(width: columnWidth)
                    }
                }
                .padding(20)
                .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }
}
#endif
