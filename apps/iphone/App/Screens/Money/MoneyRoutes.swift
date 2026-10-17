import SwiftUI

/// The Money group: Expenses, Extra revenue and Hisaab, with one person's ledger.
///
/// `/hisaab/<id>` carries `?type=customer|karigar`, which the screen reads itself (`exact` would drop
/// the query), so that route matches the bare path and hands the whole path to the screen. `?web=1` never
/// reaches these (the registry opens the ERP's page first), and no button here asks for it: the ledger's
/// print and WhatsApp reminder are native (HisaabLedgerScreen).
/// `/overheads` is the Owner group's (OverheadsScreen).
enum MoneyRoutes {
    static var all: [ScreenRoute] {
        let ledger = ScreenRoute(
            matches: { path in MoneyPaths.ledgerID(fromPath: path) != nil },
            make: { path in AnyView(HisaabLedgerScreen(path: path)) }
        )
        return [
            .exact("/expenses") { ExpensesScreen() },
            .exact("/additional-revenue") { ExtraRevenueScreen() },
            .exact("/hisaab") { HisaabScreen() },
            ledger,
        ]
    }
}
