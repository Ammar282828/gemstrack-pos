import SwiftUI

/// Analytics (src/app/analytics/*): one entry in lib/nav.ts with the tabs the web has (Overview, Sales, Profit, Cash,
/// Spending, Products, Customers, Categories and the house's metal), so the app's title menu already switches between
/// them; the tab names and order come from the nav export, never from here. Each address is its own screen over the same
/// books and the same period (`@AppStorage("erp.analytics.range")`, the web's `?range=`).
///
/// The redesign (decision "Analytics redesign"): the Overview is four figures and a set of pictures that each open the
/// page that answers them; Sales, Profit, Cash, Spending and the metal page are `Ab…Screen`s over ERPCore's `Books`
/// (the port of lib/analytics/books.ts). Products, Customers and Categories are the earlier pages, kept as they were
/// built and given the same "How this is worked out" at their foot.
enum AnalyticsRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/analytics") { AbOverviewScreen() },
            .exact("/analytics/sales") { AbSalesScreen() },
            .exact("/analytics/profit") { AbProfitScreen() },
            .exact("/analytics/cash") { AbCashScreen() },
            .exact("/analytics/spending") { AbSpendingScreen() },
            .exact("/analytics/products") { AnalyticsScreen(section: .products) },
            .exact("/analytics/customers") { AnalyticsScreen(section: .customers) },
            .exact("/analytics/categories") { AnalyticsScreen(section: .categories) },
            .exact("/analytics/metal") { AbMetalScreen() },
        ]
    }
}
