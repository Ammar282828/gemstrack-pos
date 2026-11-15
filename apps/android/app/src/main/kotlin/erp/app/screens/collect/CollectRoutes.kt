package erp.app.screens.collect

import erp.app.nav.ScreenRoute

/** Analytics › Sales › To collect (src/app/collect/page.tsx): who still owes on a bill. Owners only; `?web=1` opens the ERP's page. */
val CollectRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/collect") { CollectScreen() },
)
