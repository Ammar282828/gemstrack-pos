package erp.app.nav

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.screens.home.TeamNoteBanner
import erp.app.screens.rates.RateChip

/** True under the phone layout's bottom bar, which already takes the system navigation inset. */
val LocalBottomBar = compositionLocalOf { false }

/**
 * One ERP place: its tabs (the ERP's "one tab row per screen") as the title's menu, and the screen for the
 * chosen tab, native or the ERP page. `onClose` is set on a sheet's first screen (the create sheet).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaceScreen(
    path: String,
    isRoot: Boolean = false,
    onClose: (() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val map = remember(role) { NavMap.current.visible(role) }
    val navigator = LocalNavigator.current
    var chosen by rememberSaveable(path) { mutableStateOf<String?>(null) }

    val bare = ScreenRoute.bare(path)
    // The map as this person sees it: staff are not offered Today's cash among Home's tabs.
    val entry = if (path == SEARCH_PATH) null else map.entry(path)
    val atTab = entry?.let { e -> bare == e.href || (e.tabs ?: emptyList()).any { it.href == bare } } ?: false
    val tabs = entry?.takeIf { atTab }?.tabs ?: emptyList()
    val current = chosen ?: path
    val currentBare = ScreenRoute.bare(current)
    val mapTitle = tabs.firstOrNull { it.href == currentBare }?.title
        ?: entry?.takeIf { it.href == currentBare }?.let { it.heading ?: it.label }
    val chrome = remember(current) { Chrome() }
    val native = path == SEARCH_PATH || ScreenRegistry.hasNative(current)
    // A native screen names itself (until it does, the map's name); an ERP page is named from the map.
    val title = if (path == SEARCH_PATH) "Everything" else (if (native) chrome.title else null) ?: mapTitle ?: ""

    // A tab's first screen carries the rate chip (everyone in the shop: an owner's opens the form, anyone else's a page
    // to read) and, with Search, the team note. A sheet's first screen, a pushed page and a karigar's portal carry neither.
    val inShop = role == "owner" || role == "staff" || role == "marketing"
    val tabRoot = isRoot && onClose == null && inShop
    val rateChip = tabRoot && path != SEARCH_PATH
    val teamNote = tabRoot

    val insets = if (LocalBottomBar.current) WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Top) else WindowInsets.safeDrawing
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = insets,
        topBar = {
            TopAppBar(
                title = { TitleWithTabs(title, tabs, onChoose = { chosen = it }) },
                navigationIcon = {
                    when {
                        navigator.canGoBack -> IconButton(onClick = navigator::back) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
                        onClose != null -> IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close") }
                        rateChip -> RateChip()
                    }
                },
                actions = {
                    // On a tablet the create menu sits here, beside the page's own actions, so nothing floats over a form or the last row.
                    LocalCreateInBar.current?.let { if (isRoot) CreateMenuButton(it) }
                    chrome.actions?.invoke(this)
                    trailing?.invoke(this)
                    // The account, top right of Home as the system's own apps keep it: Settings (owners; anyone else signs out from Search).
                    if (isRoot && bare == "/" && session.isOwner) AccountButton(session.shop.person ?: me?.email ?: "") { navigator.open("/settings") }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            if (teamNote) TeamNoteBanner()
            Box(Modifier.weight(1f).fillMaxWidth()) {
                CompositionLocalProvider(LocalChrome provides chrome) {
                    key(current) {
                        if (path == SEARCH_PATH) SearchScreen() else ScreenRegistry.Screen(current)
                    }
                }
            }
        }
    }
}

@Composable
private fun CreateMenuButton(spec: CreateSpec) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(Icons.Rounded.Add, if (spec.voice) "Create: new sale, new order, scan or voice" else "Create: new sale, new order or scan")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (item in createItems(spec)) {
                DropdownMenuItem(text = { Text(item.label) }, leadingIcon = { Icon(item.icon, null) }, onClick = { open = false; spec.open(item.path) })
            }
        }
    }
}

@Composable
private fun TitleWithTabs(title: String, tabs: List<NavPlace>, onChoose: (String) -> Unit) {
    if (tabs.size <= 1) {
        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis)
        return
    }
    var open by remember { mutableStateOf(false) }
    Box {
        Row(Modifier.clickable { open = true }, verticalAlignment = Alignment.CenterVertically) {
            Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            Icon(Icons.Rounded.ArrowDropDown, contentDescription = "Switch tab")
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            tabs.forEach { t ->
                DropdownMenuItem(
                    text = { Text(t.label) },
                    leadingIcon = { Icon(NavIcon.vector(t.icon), null) },
                    onClick = { open = false; onChoose(t.href) },
                )
            }
        }
    }
}

@Composable
private fun RowScope.AccountButton(name: String, onClick: () -> Unit) {
    val initials = name.substringBefore('@').split(' ', '.', '_', '-').filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1).uppercase() }.ifEmpty { "?" }
    IconButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = "Settings" }) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(32.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Text(initials, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
    }
}
