import SwiftUI

/// The Work group: Drafts, the Calendar, the Activity log, and a karigar's own work (My work).
///
/// `/my-work` carries `?preview=<karigar id>` (an owner looking at a karigar's portal, from the karigar's page), which
/// `exact` would drop, so that route matches the bare path and hands the whole path to the screen. `?web=1` on any of
/// these opens the ERP's own page first (the registry answers it before the routes): the activity log's sign-in list
/// and emergency lock, and its Revert, live there; so does a draft begun on the web, in the web's own form.
enum WorkRoutes {
    static var all: [ScreenRoute] {
        let myWork = ScreenRoute(
            matches: { (path: String) in ScreenRoute.bare(path) == "/my-work" },
            make: { (path: String) in AnyView(MyWorkScreen(path: path)) }
        )
        return [
            .exact("/drafts") { DraftsScreen() },
            .exact("/calendar") { CalendarScreen() },
            .exact("/activity-log") { ActivityLogScreen() },
            myWork,
        ]
    }
}
