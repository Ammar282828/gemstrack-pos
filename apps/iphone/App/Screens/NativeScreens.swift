import SwiftUI

/// Every native screen's routes, group by group. A group adds its line here and nowhere else.
enum NativeScreens {
    static var all: [ScreenRoute] {
        SettingsRoutes.all + HomeRoutes.all
            // Before Orders: its `.item("/orders/")` would take "add" for an order's id.
            + NewOrderRoutes.all + OrdersRoutes.all
            + InvoicesRoutes.all + CustomersRoutes.all + RepairsRoutes.all
            + WorkshopRoutes.all + MoneyRoutes.all
    }
}
