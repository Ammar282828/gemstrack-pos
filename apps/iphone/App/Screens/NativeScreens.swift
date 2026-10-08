import SwiftUI

/// Every native screen's routes, group by group. A group adds its line here and nowhere else.
enum NativeScreens {
    static var all: [ScreenRoute] {
        SettingsRoutes.all + HomeRoutes.all + OrdersRoutes.all + InvoicesRoutes.all + CustomersRoutes.all
    }
}
