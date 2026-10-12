package erp.app.screens.owner

import erp.app.nav.ScreenRoute

/**
 * The owners' pages that were the ERP's own until now: Money → Overheads and Shareholders, and Settings → Recently
 * removed. Owners only, as on the web; anyone else meets a line saying so. `?web=1` on any of them opens the ERP's
 * page first (the registry answers it before the routes).
 */
val OwnerRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/overheads") { OverheadsScreen() },
    ScreenRoute.exact("/shareholders") { ShareholdersScreen() },
    ScreenRoute.exact("/settings/recently-removed") { RecentlyRemovedScreen() },
)
