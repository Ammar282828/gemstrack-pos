package erp.app.screens.repairs

import erp.app.nav.ScreenRegistry
import erp.app.nav.ScreenRoute

/**
 * The Repairs group: one page, /repairs (src/app/repairs/page.tsx). There is no /repairs/<id> in the ERP: a repair opens as a
 * sheet on the list, and the ERP links to it as /repairs?id=REP-000001 (the dashboard's rows, Today's cash, Extra revenue) or
 * asks for the form as /repairs?new=1 (New repair in the create menu). `exact` would drop that query, so the route matches the
 * bare path itself and hands the whole path to the screen. "?web=1" is left unmatched on purpose, so Edit and Delete reach the
 * ERP's own page (the registry would otherwise open the native screen again).
 */
val RepairsRoutes: List<ScreenRoute> = listOf(
    ScreenRoute(
        matches = { path -> ScreenRoute.bare(path) == "/repairs" && !ScreenRegistry.wantsWeb(path) },
        make = { path -> RepairsScreen(path) },
    ),
)
