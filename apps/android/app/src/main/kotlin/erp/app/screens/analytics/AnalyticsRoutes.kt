package erp.app.screens.analytics

import erp.app.nav.ScreenRoute

/**
 * Analytics (src/app/analytics): one entry in lib/nav.ts with nine tabs (the redesign of 2026-11-05 added Profit, Cash,
 * Spending and the house's metal), so the app's title menu already switches between them. Each address is its own screen
 * over the same books and the same period (kept in [AnaPeriodStore], the web's `?range=`).
 */
val AnalyticsRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/analytics") { AnalyticsScreen(AnaSection.overview) },
    ScreenRoute.exact("/analytics/sales") { AnalyticsScreen(AnaSection.sales) },
    ScreenRoute.exact("/analytics/profit") { AnalyticsScreen(AnaSection.profit) },
    ScreenRoute.exact("/analytics/cash") { AnalyticsScreen(AnaSection.cash) },
    ScreenRoute.exact("/analytics/spending") { AnalyticsScreen(AnaSection.spending) },
    ScreenRoute.exact("/analytics/products") { AnalyticsScreen(AnaSection.products) },
    ScreenRoute.exact("/analytics/customers") { AnalyticsScreen(AnaSection.customers) },
    ScreenRoute.exact("/analytics/categories") { AnalyticsScreen(AnaSection.categories) },
    ScreenRoute.exact("/analytics/metal") { AnalyticsScreen(AnaSection.metal) },
)
