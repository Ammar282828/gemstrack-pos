import SwiftUI

/// The Orders group: the hub and the order page. New order (/orders/add) stays the ERP's own page:
/// "/orders/add" also matches the item route below, so OrderScreen hands it to WebScreen itself.
enum OrdersRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/orders") { OrdersHub() },
            // Before the item route, which would take "online" for an order's id.
            .exact("/orders/online") { OnlineOrdersScreen() },
            .item("/orders/") { id in OrderScreen(id: id) },
        ]
    }
}
