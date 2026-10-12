package erp.app.screens

import erp.app.nav.ScreenRoute
import erp.app.screens.customers.CustomersRoutes
import erp.app.screens.home.HomeRoutes
import erp.app.screens.invoices.InvoicesRoutes
import erp.app.screens.money.MoneyRoutes
import erp.app.screens.neworder.NewOrderRoutes
import erp.app.screens.orders.OrdersRoutes
import erp.app.screens.owner.OwnerRoutes
import erp.app.screens.repairs.RepairsRoutes
import erp.app.screens.sale.SaleRoutes
import erp.app.screens.stock.StockRoutes
import erp.app.screens.work.WorkRoutes
import erp.app.screens.workshop.WorkshopRoutes

/**
 * Every native screen's routes, group by group. A group adds its line here and nowhere else (a screen group lives
 * in erp/app/screens/<group>/ with a `<Group>Routes.kt` exposing `val <Group>Routes: List<ScreenRoute>`).
 * The first route that matches a path wins, so order matters where two groups share a prefix.
 */
object NativeScreens {
    val all: List<ScreenRoute> by lazy {
        listOf(
            HomeRoutes,
            // Before Orders: its "/orders/add" would otherwise be taken for an order's id.
            NewOrderRoutes,
            OrdersRoutes,
            // Before Invoices: "/invoices/new" is the Sale group's, and the invoice item route would take "new" for an id.
            SaleRoutes,
            InvoicesRoutes,
            CustomersRoutes,
            RepairsRoutes,
            StockRoutes,
            WorkshopRoutes,
            // The Swift order: Customers, Repairs, Stock and Workshop come between Invoices and Money.
            MoneyRoutes,
            // My work (a karigar's portal) comes after Analytics in the Swift order; the owners' pages share no prefix with it.
            WorkRoutes,
            OwnerRoutes,
        ).flatten()
    }
}
