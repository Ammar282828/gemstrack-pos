import SwiftUI

/// The Orders group: the hub and the order page. New order (/orders/add) is the New order group's, which comes
/// first in NativeScreens; "/orders/add" also matches the item route below, so OrderScreen shows NewOrder itself.
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
