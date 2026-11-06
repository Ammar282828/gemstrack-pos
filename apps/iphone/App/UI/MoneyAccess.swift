import SwiftUI

/// Who may see an amount outside the one bill in hand (decision "Staff see no money"; `Session.seesMoney`, the
/// ERP's `seesMoney`: owners only). A staff member sees every amount on Orders, Invoices, Repairs, Drafts and in search;
/// everywhere else a figure that sums or lists money is drawn with `.moneyHidden()` (or guarded by `session.seesMoney`).
private struct MoneyHiddenModifier: ViewModifier {
    @Environment(Session.self) private var session

    func body(content: Content) -> some View {
        if session.seesMoney { content }
    }
}

extension View {
    /// This view only for someone who sees money; for staff it is not drawn at all (no gap is left by the view itself).
    func moneyHidden() -> some View { modifier(MoneyHiddenModifier()) }
}
