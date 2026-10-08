import SwiftUI

/// The New order group: the order form (src/app/orders/add/page.tsx, components/order/order-form.tsx).
///
/// "/orders/add" also matches the Orders group's `.item("/orders/")`, which would hand "add" to
/// OrderScreen as if it were an order id, so this group's term goes BEFORE OrdersRoutes in
/// `NativeScreens.all`. The AI slip reader and the voice order stay on the ERP's page (`?web=1`).
enum NewOrderRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/orders/add") { NewOrder() },
        ]
    }
}
