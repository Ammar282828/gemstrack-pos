import SwiftUI

/// Home: the dashboard and Today's cash. The third tab, /calendar, is the Work group's (CalendarScreen).
enum HomeRoutes {
    static var all: [ScreenRoute] {
        [
            .exact("/") { Dashboard() },
            .exact("/today") { TodaysCashScreen() },
            // Help: the step-by-step guides (src/app/help); in Home's tabs for staff.
            .exact("/help") { HelpScreen() },
        ]
    }
}
