package erp.app.screens.home

import erp.app.nav.ScreenRoute
import erp.app.screens.voice.VoiceOpener

/**
 * Home's routes: the dashboard and Today's cash (HomeRoutes.swift). The third tab, /calendar, is the Work group's.
 * The voice assistant (the create menu's last item, owners only) is a capsule over whatever is open (screens/voice/VoiceOverlay), never a page.
 */
val HomeRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/") { Dashboard() },
    ScreenRoute.exact("/help") { HelpScreen() },
    ScreenRoute.exact("/today") { TodaysCashScreen() },
    ScreenRoute.exact("/voice") { VoiceOpener() },
)
