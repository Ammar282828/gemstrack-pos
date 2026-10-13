package erp.app.screens.analytics

import erp.app.nav.ScreenRoute

/**
 * Analytics (src/app/analytics (five pages)): one entry in lib/nav.ts with five tabs, so the app's title menu already switches
 * between them. Each address is its own screen over the same books and the same period (kept in [AnaPeriodStore], the
 * web's `?range=`).
 */
val AnalyticsRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/analytics") { AnalyticsScreen(AnaSection.overview) },
    ScreenRoute.exact("/analytics/sales") { AnalyticsScreen(AnaSection.sales) },
    ScreenRoute.exact("/analytics/products") { AnalyticsScreen(AnaSection.products) },
    ScreenRoute.exact("/analytics/customers") { AnalyticsScreen(AnaSection.customers) },
    ScreenRoute.exact("/analytics/categories") { AnalyticsScreen(AnaSection.categories) },
)
