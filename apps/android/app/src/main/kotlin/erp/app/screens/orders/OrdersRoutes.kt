package erp.app.screens.orders

import erp.app.nav.ScreenRoute

/**
 * The Orders group: the hub, the online inbox, the order page and Finalize & invoice. New order (/orders/add)
 * stays the ERP's own page until its group lands: "/orders/add" also matches the item route below, so OrderScreen
 * hands it to WebScreen itself. On the iPhone Finalize's route belongs to NewOrderRoutes; its screen is this
 * group's, so the route is registered here, before the item route (which leaves a path with a slash in it alone).
 */
val OrdersRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/orders") { OrdersHub() },
    // Before the item route, which would take "online" for an order's id.
    ScreenRoute.exact("/orders/online") { OnlineOrdersScreen() },
    // "/orders/<id>/finalize": Finalize & invoice (the web's ?do=finalize dialog), native.
    ScreenRoute(
        matches = { OrderPaths.finalizeId(it) != null },
        make = { OrderFinalizeScreen(OrderPaths.finalizeId(it) ?: "") },
    ),
    ScreenRoute.item("/orders/") { id -> OrderScreen(id) },
)
