package erp.app.screens.work

import erp.app.nav.ScreenRoute

/**
 * The Work group: Drafts, the Calendar, the Activity log, and a karigar's own work (My work).
 *
 * `/my-work` carries `?preview=<karigar id>` (an owner looking at a karigar's portal, from the karigar's page), which `exact`
 * would drop, so that route matches the bare path and hands the whole path to the screen. `?web=1` on any of these opens the
 * ERP's own page first (the registry answers it before the routes): the activity log's sign-in list and emergency lock, and
 * its Revert, live there; so does a draft begun on the web, in the web's own form.
 */
val WorkRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/drafts") { DraftsScreen() },
    ScreenRoute.exact("/calendar") { CalendarScreen() },
    ScreenRoute.exact("/activity-log") { ActivityLogScreen() },
    ScreenRoute(
        matches = { path -> ScreenRoute.bare(path) == "/my-work" },
        make = { path -> MyWorkScreen(path) },
    ),
)
