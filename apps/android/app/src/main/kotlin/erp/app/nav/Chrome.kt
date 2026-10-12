package erp.app.nav

import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue

/**
 * The top bar a place is drawn under (PlaceScreen owns it, one per screen on a stack). A native screen names
 * itself and adds its own actions with the two calls below, as the iPhone's `.navigationTitle` and `.toolbar`;
 * an ERP page is named from the map.
 */
class Chrome {
    var title by mutableStateOf<String?>(null)
    var actions by mutableStateOf<(@Composable RowScope.() -> Unit)?>(null)
}

val LocalChrome = compositionLocalOf<Chrome?> { null }

/** The screen's title in the top bar. */
@Composable
fun ScreenTitle(title: String) {
    val chrome = LocalChrome.current
    DisposableEffect(chrome, title) {
        chrome?.title = title
        onDispose { if (chrome?.title == title) chrome.title = null }
    }
}

/** The screen's own actions at the end of the top bar (filters, Settings). */
@Composable
fun ScreenActions(content: @Composable RowScope.() -> Unit) {
    val chrome = LocalChrome.current
    val latest by rememberUpdatedState(content)
    DisposableEffect(chrome) {
        chrome?.actions = { latest() }
        onDispose { chrome?.actions = null }
    }
}
