import SwiftUI

/// The Repairs group: one page, /repairs (src/app/repairs/page.tsx). There is no /repairs/<id> in the
/// ERP: a repair opens as a sheet on the list, and the ERP links to it as /repairs?id=REP-000001
/// (the dashboard's rows, Today's cash, Extra revenue) or asks for the form as /repairs?new=1
/// (New repair in the create menu). `exact` would drop that query, so the route matches the bare path
/// itself and hands the whole path to the screen. "?web=1" is left unmatched on purpose, so Edit and
/// Delete reach the ERP's own page (the registry would otherwise open the native screen again).
enum RepairsRoutes {
    static var all: [ScreenRoute] {
        let repairs = ScreenRoute(
            matches: { path in ScreenRoute.bare(path) == "/repairs" && !ScreenRegistry.wantsWeb(path) },
            make: { path in AnyView(RepairsScreen(path: path)) }
        )
        return [repairs]
    }
}
