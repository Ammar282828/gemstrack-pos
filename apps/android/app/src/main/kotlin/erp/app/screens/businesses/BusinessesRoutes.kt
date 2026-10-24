package erp.app.screens.businesses

import erp.app.nav.ScreenRoute

/** `/app/businesses` (Settings → Businesses, Search → Businesses): the businesses on this phone, and the way to add one by its ERP's address. */
val BusinessesRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/app/businesses") { BusinessesScreen() },
)
