package erp.app.nav

import erp.app.ui.icons.Symbols
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** What the empty right-hand side says (HubSplit.swift `HubSplitKind`). */
class HubPrompt(val title: String, val icon: ImageVector)

/** Which hub tabs split into a list and the item beside it on a wide window, keyed by the tab's path. */
object HubSplitKind {
    fun prompt(path: String): HubPrompt? = when (ScreenRoute.bare(path)) {
        "/orders" -> HubPrompt("Choose an order", Symbols.Assignment)
        "/invoices" -> HubPrompt("Choose an invoice", Symbols.Description)
        "/customers" -> HubPrompt("Choose a customer", Symbols.People)
        "/products" -> HubPrompt("Choose a piece", Symbols.Diamond)
        "/repairs" -> HubPrompt("Choose a repair", Symbols.Build)
        else -> null
    }

    /** Below this the two columns would each be too tight to read: the phone's one stack. */
    val wideEnough: Dp = 700.dp
}

/**
 * A hub tab on a wide window (the iPad's `HubSplit`): the hub as the list column and the picked item beside it, in a
 * stack of its own. The right-hand side is always there while the window is wide enough, empty with a prompt until
 * something is picked (owner, 2026-10-24: "if I haven't selected anything … it should leave empty space"), rather
 * than the list stretched across the window.
 *
 * [hub] draws the list and is handed what a tap on a row does: it lands in the item column (every row, whatever the
 * path). Pages opened from the item (a customer's invoice, an invoice's order) push on the item column's own stack
 * and keep its back arrow; the system Back pops them first.
 */
@Composable
fun HubSplit(prompt: HubPrompt, modifier: Modifier = Modifier, hub: @Composable (pick: (String) -> Unit) -> Unit) {
    // The item column's stack: the picked path first, then what was opened from it. Saved with the tab.
    val shown = rememberSaveable(saver = listSaver(save = { it.toList() }, restore = { it.toMutableStateList() })) { mutableStateListOf<String>() }
    val pick: (String) -> Unit = { path -> shown.clear(); shown.add(path) }
    val detailNavigator = remember(shown) {
        object : Navigator {
            override fun open(path: String) { if (shown.lastOrNull() != path) shown.add(path) }
            override fun replace(path: String) { if (shown.isEmpty()) shown.add(path) else shown[shown.lastIndex] = path }
            override fun back() { if (shown.size > 1) shown.removeAt(shown.lastIndex) }
            override val canGoBack: Boolean get() = shown.size > 1
        }
    }
    BackHandler(enabled = shown.size > 1) { detailNavigator.back() }

    BoxWithConstraints(modifier.fillMaxSize()) {
        val listWidth = (maxWidth * 0.38f).coerceIn(340.dp, 420.dp)
        Row(Modifier.fillMaxSize()) {
            Column(Modifier.width(listWidth).fillMaxHeight()) { hub(pick) }
            VerticalDivider()
            Column(Modifier.weight(1f).fillMaxHeight()) {
                val top = shown.lastOrNull()
                if (top == null) {
                    HubPlaceholder(prompt)
                } else {
                    CompositionLocalProvider(LocalNavigator provides detailNavigator) {
                        // A new item is a new page: its own state, as the iPad's `.id(picked)`.
                        key(shown.first(), shown.size) { PlaceScreen(top, isRoot = false) }
                    }
                }
            }
        }
    }
}

/** The empty item column: an icon and what to do (the iPad's ContentUnavailableView). */
@Composable
private fun HubPlaceholder(prompt: HubPrompt) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Icon(prompt.icon, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(prompt.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}
