import SwiftUI

/// Every native screen's routes, group by group. A group adds its line here and nowhere else.
/// The first route that matches a path wins, so order matters where two groups share a prefix.
enum NativeScreens {
    static var all: [ScreenRoute] {
        [
            SettingsRoutes.all,
            HomeRoutes.all,
            // Before Orders: its `.item("/orders/")` would take "add" for an order's id.
            NewOrderRoutes.all,
            OrdersRoutes.all,
            // "/invoices/new" is the Sale group's; the Invoices group's item route leaves "new" out too.
            SaleRoutes.all,
            InvoicesRoutes.all,
            CustomersRoutes.all,
            RepairsRoutes.all,
            StockRoutes.all,
            WorkshopRoutes.all,
            MoneyRoutes.all,
            AnalyticsRoutes.all,
            WorkRoutes.all,
            // Posts, the website's pieces and the Ads overview and campaigns; the heavy editors stay the ERP's pages.
            MarketingRoutes.all,
        ].flatMap { $0 }
    }
}
