package erp.app.screens.home

import erp.app.nav.ScreenRoute
import erp.app.screens.voice.VoiceScreen

/**
 * Home's routes: the dashboard and Today's cash (HomeRoutes.swift). The third tab, /calendar, is the Work group's.
 * The voice assistant (the create menu's last item, owners only) is a sheet over the tabs (screens/voice).
 */
val HomeRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/") { Dashboard() },
    ScreenRoute.exact("/today") { TodaysCashScreen() },
    ScreenRoute.exact("/voice") { VoiceScreen() },
)
