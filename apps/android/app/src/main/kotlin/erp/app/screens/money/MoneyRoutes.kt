package erp.app.screens.money

import erp.app.nav.ScreenRoute

/**
 * The Money group: Expenses, Extra revenue and Hisaab, with one person's ledger.
 *
 * `/hisaab/<id>` carries `?type=customer|karigar`, which the screen reads itself (`exact` would drop the query), so
 * that route matches the bare path and hands the whole path to the screen. `?web=1` (the ledger's print and reminder
 * page) never reaches these: the registry opens the ERP's page first. `/overheads` is the Owner group's (OverheadsScreen).
 */
val MoneyRoutes: List<ScreenRoute> = run {
    val ledger = ScreenRoute(
        matches = { path -> MoneyPaths.ledgerID(path) != null },
        make = { path -> HisaabLedgerScreen(path) },
    )
    listOf(
        ScreenRoute.exact("/expenses") { ExpensesScreen() },
        ScreenRoute.exact("/additional-revenue") { ExtraRevenueScreen() },
        ScreenRoute.exact("/hisaab") { HisaabScreen() },
        ledger,
    )
}
