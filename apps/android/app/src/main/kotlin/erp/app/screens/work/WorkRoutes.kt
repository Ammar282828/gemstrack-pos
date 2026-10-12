package erp.app.screens.work

import erp.app.nav.ScreenRoute

/**
 * The Work group, here only its karigar half: My work, a karigar's own portal. (Drafts, the Calendar and the Activity log
 * are another port's; they add their routes beside this one.)
 *
 * `/my-work` carries `?preview=<karigar id>` (an owner looking at a karigar's portal, from the karigar's page), which `exact`
 * would drop, so that route matches the bare path and hands the whole path to the screen. `?web=1` opens the ERP's own page
 * first (the registry answers it before the routes).
 */
val WorkRoutes: List<ScreenRoute> = listOf(
    ScreenRoute(
        matches = { path -> ScreenRoute.bare(path) == "/my-work" },
        make = { path -> MyWorkScreen(path) },
    ),
)
