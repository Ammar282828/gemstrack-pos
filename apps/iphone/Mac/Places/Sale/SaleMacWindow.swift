#if os(macOS)
import SwiftUI
import ERPCore

// The parts of the Mac's New sale / Edit invoice window that are not the sale's own: what one window remembers about
// itself (the stock column, the pieces picked on the bill, the sections opened), the actions it publishes, and a way to
// open a record in a window of its own. docs/features/mac-design.md, "New sale". Everything the window does to the sale
// is SaleForm's own (NewSale.swift, SaleSections.swift); this is only arrangement.

/// What one New sale window holds besides the sale: its own, so two windows never share a column or a pick.
@MainActor @Observable
final class SaleMacUI {
    static let stockKey = "mac.sale.stock"

    /// Goes up on Add Piece (⌘L): the scanner's box takes the keyboard.
    var scannerAsks = 0
    /// The stock column is shown. Remembered for the next window.
    var stockShown: Bool = UserDefaults.standard.object(forKey: SaleMacUI.stockKey) as? Bool ?? true
    /// The pieces picked on the bill, by SKU.
    var picked = Set<String>()
    /// The sections opened under the sale's panel.
    var ratesOpen: Bool
    var deliveryOpen = false
    var shopOpen = false

    init(ratesOpen: Bool = false) {
        self.ratesOpen = ratesOpen
    }

    func toggleStock() {
        stockShown.toggle()
        UserDefaults.standard.set(stockShown, forKey: SaleMacUI.stockKey)
    }

    /// ⌘L: the column shows if it was put away, and the box takes the keyboard.
    func focusScanner() {
        if !stockShown { toggleStock() }
        scannerAsks += 1
    }
}

/// Holds one window's `SaleMacUI` and hands it to the layout, so the menu's actions and the views see the same one.
struct SaleMacHost<Content: View>: View {
    @State private var ui: SaleMacUI
    private let content: (SaleMacUI) -> Content

    init(ratesFirst: Bool, @ViewBuilder content: @escaping (SaleMacUI) -> Content) {
        _ui = State(initialValue: SaleMacUI(ratesOpen: ratesFirst))
        self.content = content
    }

    var body: some View {
        content(ui)
    }
}

/// Every action of the window, declared once (docs/features/mac-design.md, rule 3): the menu bar's Sale menu, the
/// toolbar and the right-click menus read these, so they never disagree about what can be done or which key does it.
struct SaleMacActions {
    var save: MacAction
    var addPiece: MacAction
    var newItem: MacAction
    var scanTag: MacAction
    var readBill: MacAction
    var editPiece: MacAction
    var removePieces: MacAction
    var createOrder: MacAction
    var startOver: MacAction
}

// MARK: Opening a record in a window of its own

/// Opens a place in a window of its own: the shell's `openPlaceWindow` where the environment has it, else the app's
/// window group, so a link never goes quiet in a window the shell did not make.
struct SaleMacOpener {
    let openPlace: OpenPlaceWindow?
    let openWindow: OpenWindowAction

    func callAsFunction(_ route: Route) {
        if let openPlace {
            openPlace(route)
        } else {
            openWindow(id: MacWindows.place, value: route)
        }
    }
}

/// Reads the window environment once and hands the opener to its content.
struct SaleMacOpenReader<Content: View>: View {
    @Environment(\.openPlaceWindow) private var openPlace
    @Environment(\.openWindow) private var openWindow
    @ViewBuilder let content: (SaleMacOpener) -> Content

    var body: some View {
        content(SaleMacOpener(openPlace: openPlace, openWindow: openWindow))
    }
}

// MARK: Round ▾

/// The discount's Round ▾ menu: the same offers the round-off chips give (App/UI/RoundOff.swift, ERPCore's
/// `roundOffOffers`: up to three round-downs of the bill, each a small extra discount), as a pop-up. Taking one adds
/// its extra to the discount typed; taking the ticked one, or Undo, puts the discount back as it was.
struct SaleMacRoundMenu: View {
    /// What the bill comes to before any discount (the pieces less the exchange).
    let payable: Double
    /// The discount as it stands.
    let discount: Double
    /// Receives the bill's whole discount once an offer is taken (or undone).
    let change: (Double) -> Void

    /// The discount before the offer, and the total the offer made: ticked while the bill still comes to it.
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
        Menu {
            ForEach(offers, id: \.target) { o in
                Button { take(o, chosen: lit?.target == o.target, base: base) } label: {
                    offerLabel(o, chosen: lit?.target == o.target)
                }
            }
            if lit != nil {
                Divider()
                Button("Undo Round-off") {
                    applied = nil
                    change(base)
                }
            }
        } label: {
            Text("Round")
        }
        .disabled(offers.isEmpty && lit == nil)
        .help("Give a small extra discount to round the bill down")
    }

    @ViewBuilder
    private func offerLabel(_ o: RoundOffOffer, chosen: Bool) -> some View {
        if chosen {
            Label(roundOffLabel(o), systemImage: "checkmark")
        } else {
            Text(roundOffLabel(o))
        }
    }

    private func take(_ o: RoundOffOffer, chosen: Bool, base: Double) {
        if chosen {
            applied = nil
            change(base)
        } else {
            applied = Applied(base: base, target: o.target)
            change(discountWithOffer(base, o))
        }
    }
}
#endif
