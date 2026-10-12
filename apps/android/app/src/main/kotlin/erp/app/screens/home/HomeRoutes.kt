package erp.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.nav.ScreenRoute
import erp.app.nav.ScreenTitle

/**
 * Home's routes: the dashboard and Today's cash (HomeRoutes.swift). The third tab, /calendar, is the Work group's.
 * The voice assistant (the create menu's last item, owners only) keeps its place, answering that it is coming.
 */
val HomeRoutes: List<ScreenRoute> = listOf(
    ScreenRoute.exact("/") { Dashboard() },
    ScreenRoute.exact("/today") { TodaysCashScreen() },
    ScreenRoute.exact("/voice") { ComingSoon("Voice assistant", "The voice assistant arrives with the next update. Until then, say it to the ERP in the browser.") },
)

@Composable
private fun ComingSoon(title: String, message: String) {
    ScreenTitle(title)
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
