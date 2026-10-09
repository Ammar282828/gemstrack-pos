import SwiftUI

/// Home: the dashboard and Today's cash. The third tab, /calendar, is the Work group's (CalendarScreen).
enum HomeRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/") { Dashboard() },
            .exact("/today") { TodaysCashScreen() },
        ]
    }
}
