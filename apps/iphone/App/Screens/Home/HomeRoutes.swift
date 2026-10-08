import SwiftUI

/// Home: the dashboard and Today's cash. The third tab, /calendar, stays the ERP's own page (no route here).
enum HomeRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/") { Dashboard() },
            .exact("/today") { TodaysCashScreen() },
        ]
    }
}
