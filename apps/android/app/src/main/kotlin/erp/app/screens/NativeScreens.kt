package erp.app.screens

import erp.app.nav.ScreenRoute
import erp.app.screens.home.HomeRoutes
import erp.app.screens.orders.OrdersRoutes

/**
 * Every native screen's routes, group by group. A group adds its line here and nowhere else (a screen group lives
 * in erp/app/screens/<group>/ with a `<Group>Routes.kt` exposing `val <Group>Routes: List<ScreenRoute>`).
 * The first route that matches a path wins, so order matters where two groups share a prefix.
 */
object NativeScreens {
    val all: List<ScreenRoute> by lazy {
        listOf(
            HomeRoutes,
            // NewOrderRoutes (when it lands) must precede this: Orders' `.item("/orders/")` would take "add" for an order's id.
            OrdersRoutes,
            // Next: Settings, New order, Orders, New sale, Invoices, Customers, Repairs, Stock, Workshop, Money, Analytics, My work, Owner, Marketing.
        ).flatten()
    }
}
