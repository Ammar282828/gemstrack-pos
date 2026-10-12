package erp.app.nav

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Payments
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FloatingActionButtonMenu
import androidx.compose.material3.FloatingActionButtonMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleFloatingActionButton
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.window.core.layout.WindowSizeClass
import erp.app.R
import erp.app.auth.LocalSession
import erp.app.data.LocalBook
import erp.app.data.OnlineInbox
import erp.app.ui.LocalNoteState
import erp.app.ui.NoteHost

/** The phone's four most-used places, before Search. */
private val PRIMARY = listOf("home", "orders", "invoices", "customers")

/**
 * The app: the shop's four most-used places as tabs, the ERP's whole map under Search, and New sale / New order /
 * Scan always one tap away. A marketing account gets its own first four (Posts, Website, Ads …) and no create menu:
 * the ERP gives it nothing to create. Tablets and unfolded phones get a rail with every entry and the house's logo.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun RootScaffold() {
    val session = LocalSession.current
    val book = LocalBook.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val shop = me?.shop ?: session.shop
    val map = remember(role) { NavMap.current.visible(role) }

    val wide = currentWindowAdaptiveInfoV2().windowSizeClass.isWidthAtLeastBreakpoint(WindowSizeClass.WIDTH_DP_MEDIUM_LOWER_BOUND)
    val tabs = remember(map, wide, role) {
        when {
            wide -> map.entries
            // Marketing has no dashboard: the ERP sends it to Posts, the first page it may open.
            role == "marketing" -> map.entries.take(4)
            else -> PRIMARY.mapNotNull { id -> map.entries.firstOrNull { it.id == id } }
        }
    }
    val ids = tabs.map { it.id } + SEARCH_TAB
    var chosen by rememberSaveable { mutableStateOf(PRIMARY.first()) }
    // The chosen tab, or the first one when the remembered choice is not this person's (no Home for marketing).
    val selected = if (chosen in ids) chosen else (tabs.firstOrNull()?.id ?: SEARCH_TAB)
    val stacks = ids.associateWith { id ->
        key(id) { rememberNavBackStack(Route(if (id == SEARCH_TAB) SEARCH_PATH else tabs.first { it.id == id }.href)) }
    }

    // One sheet over the tabs for create actions, links and tapped notifications, with its own back stack.
    var creating by rememberSaveable { mutableStateOf<String?>(null) }
    val incoming by AppRouter.open.collectAsStateWithLifecycle()
    LaunchedEffect(incoming) { incoming?.let { creating = it; AppRouter.consumed() } }

    val canCreate = role != "marketing"
    val create = CreateSpec(map.newSale?.href, voice = role == "owner", open = { creating = it })

    // Online orders waiting beside Orders, as the web's sidebar counts them (nav.ts `count: 'online'`). Owners confirm them.
    val waiting by OnlineInbox.waiting.collectAsStateWithLifecycle()
    val watchesOnline = shop.websiteSelling && (role == "owner" || role == "staff")
    LaunchedEffect(watchesOnline) { if (watchesOnline) OnlineInbox.keep() }
    // The settings carry the shop's theme and its urgent note; every tab wants them.
    LaunchedEffect(Unit) { book.settings.need() }

    val layout = if (wide) NavigationSuiteType.WideNavigationRailExpanded else NavigationSuiteType.ShortNavigationBarCompact

    BackHandler(enabled = selected != tabs.firstOrNull()?.id && (stacks[selected]?.size ?: 1) <= 1) {
        chosen = tabs.firstOrNull()?.id ?: SEARCH_TAB
    }

    NavigationSuiteScaffold(
        navigationSuiteType = layout,
        navigationItems = {
            if (wide) {
                Image(
                    painterResource(R.drawable.brand_logo),
                    stringResource(R.string.app_name),
                    Modifier.widthIn(max = 200.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), // widthIn first: after fillMaxWidth it cannot narrow
                )
            }
            tabs.forEach { e ->
                NavigationSuiteItem(
                    navigationSuiteType = layout,
                    selected = selected == e.id,
                    onClick = { if (selected == e.id) popToRoot(stacks[e.id]) else chosen = e.id },
                    icon = {
                        // The Orders row carries the online-orders count for owners.
                        val badge = if (e.count == "online" && role == "owner" && shop.websiteSelling) waiting else 0
                        BadgedBox(badge = { if (badge > 0) Badge { Text(if (badge > 99) "99+" else badge.toString()) } }) { Icon(NavIcon.vector(e.icon), null) }
                    },
                    label = { Text(if (e.id == "home") "Home" else e.label) },
                )
            }
            // Search is also the way to everything else: idle, it lists the ERP's whole map with Settings and the account.
            NavigationSuiteItem(
                // Told which bar this is: left to itself an item picks its own style from the window, and drew the
                // short rail's stacked labels inside the expanded rail.
                navigationSuiteType = layout,
                selected = selected == SEARCH_TAB,
                onClick = { if (selected == SEARCH_TAB) popToRoot(stacks[SEARCH_TAB]) else chosen = SEARCH_TAB },
                icon = { Icon(Icons.Rounded.Search, null) },
                label = { Text("Search") },
            )
        },
    ) {
        Box(Modifier.fillMaxSize()) {
            // Every tab keeps its stack; the chosen one is drawn.
            key(selected) {
                CompositionLocalProvider(
                    LocalBottomBar provides !wide,
                    LocalCreateInBar provides (if (wide && canCreate) create else null),
                ) {
                    stacks[selected]?.let { StackHost(it, Modifier.fillMaxSize()) }
                }
            }
            if (!wide && canCreate) CreateButton(create, Modifier.align(Alignment.BottomEnd).padding(16.dp))
        }
    }

    creating?.let { path ->
        CreateSheet(path, onClose = { creating = null })
    }
}

private const val SEARCH_TAB = "search"

private fun popToRoot(stack: androidx.navigation3.runtime.NavBackStack<NavKey>?) {
    if (stack != null) while (stack.size > 1) stack.removeAt(stack.lastIndex)
}

/** What the create menu offers: New sale (owners; the map says), New order, Scan, and the voice assistant (owners). */
class CreateSpec(val sale: String?, val voice: Boolean, val open: (String) -> Unit)

/** Set on tablets, where the create menu sits in the top bar of each tab's first screen. */
val LocalCreateInBar = androidx.compose.runtime.compositionLocalOf<CreateSpec?> { null }

/** The floating New sale · Order · Scan · Voice menu of phones. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun CreateButton(spec: CreateSpec, modifier: Modifier) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = expanded) { expanded = false }
    FloatingActionButtonMenu(
        expanded = expanded,
        modifier = modifier,
        button = {
            ToggleFloatingActionButton(checked = expanded, onCheckedChange = { expanded = it }) {
                Icon(if (expanded) Icons.Rounded.Close else Icons.Rounded.Add, if (expanded) "Close the create menu" else "Create: new sale, new order, scan or voice")
            }
        },
    ) {
        for (item in createItems(spec)) {
            FloatingActionButtonMenuItem(
                onClick = { expanded = false; spec.open(item.path) },
                icon = { Icon(item.icon, null) },
                text = { Text(item.label) },
            )
        }
    }
}

class CreateItem(val label: String, val path: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

fun createItems(spec: CreateSpec): List<CreateItem> = buildList {
    spec.sale?.let { add(CreateItem("New sale", it, Icons.Rounded.Payments)) }
    add(CreateItem("New order", "/orders/add", Icons.AutoMirrored.Rounded.Assignment))
    add(CreateItem("Scan", "/scan", Icons.Rounded.QrCodeScanner))
    if (spec.voice) add(CreateItem("Voice", "/voice", Icons.Rounded.Mic))
}

/** A full-screen sheet over the tabs with a back stack of its own: a create action, a link, a notification. */
@Composable
private fun CreateSheet(path: String, onClose: () -> Unit) {
    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        key(path) {
            val stack = rememberNavBackStack(Route(path))
            // The dialog has its own back dispatcher: a screen on the sheet's stack goes first, then the sheet.
            BackHandler(enabled = stack.size > 1) { stack.removeAt(stack.lastIndex) }
            androidx.compose.material3.Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxSize()) {
                    StackHost(stack, Modifier.fillMaxSize(), onClose = onClose)
                    // A dialog is a window above the app's own banner: the same note, shown again here (the app's copy buzzes).
                    NoteHost(LocalNoteState.current, haptics = false)
                }
            }
        }
    }
}
