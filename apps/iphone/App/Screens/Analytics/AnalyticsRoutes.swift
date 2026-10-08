import SwiftUI

/// Analytics (src/app/analytics/*): one entry in lib/nav.ts with five tabs, so the app's title menu
/// already switches between them. Each address is its own screen over the same books and the same
/// period (`@AppStorage("erp.analytics.range")`, the web's `?range=`).
enum AnalyticsRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/analytics") { AnalyticsScreen(section: .overview) },
            .exact("/analytics/sales") { AnalyticsScreen(section: .sales) },
            .exact("/analytics/products") { AnalyticsScreen(section: .products) },
            .exact("/analytics/customers") { AnalyticsScreen(section: .customers) },
            .exact("/analytics/categories") { AnalyticsScreen(section: .categories) },
        ]
    }
}
