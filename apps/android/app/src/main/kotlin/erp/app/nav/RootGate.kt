package erp.app.nav

import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration
import android.content.res.Resources
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import erp.app.auth.LocalSession
import erp.app.auth.Session
import erp.app.auth.SignInScreen
import erp.app.auth.findActivity
import erp.app.config.Prefs
import erp.app.data.LocalBook
import erp.app.device.CrashReportDialog
import erp.app.ui.LocalNoteState
import erp.app.ui.NoteHost
import erp.app.ui.rememberNoteState
import erp.app.ui.theme.ErpTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The theme the shop and the phone choose (Settings → Appearance writes `deviceTheme`; the shop's settings carry its own). */
object ThemeChoice {
    private const val DEVICE_KEY = "deviceTheme"
    private const val SHOP_KEY = "erp.lastShopTheme"

    private val _device = MutableStateFlow("")
    val device: StateFlow<String> = _device.asStateFlow()
    private val _lastShop = MutableStateFlow("")
    val lastShop: StateFlow<String> = _lastShop.asStateFlow()

    /** Read once the preferences exist. */
    fun load() {
        _device.value = Prefs.string(DEVICE_KEY).orEmpty()
        _lastShop.value = Prefs.string(SHOP_KEY).orEmpty()
    }

    /** "" follows the shop. */
    fun setDevice(theme: String) { Prefs.putString(DEVICE_KEY, theme.ifEmpty { null }); _device.value = theme }

    /** The shop's theme as the settings last said, so a cold start opens in it before the settings are read again. */
    fun rememberShop(theme: String) { Prefs.putString(SHOP_KEY, theme); _lastShop.value = theme }

    /** True for dark, false for light, null to follow the device: the device's own choice wins over the shop's. */
    fun preferredDark(deviceTheme: String, shopTheme: String?, lastShopTheme: String): Boolean? {
        val theme = if (deviceTheme.isEmpty()) (shopTheme ?: lastShopTheme) else deviceTheme
        return when (theme) {
            "default" -> false
            "taheri", "slate" -> true
            else -> null
        }
    }
}

/** The whole app under the house's theme, the session and the books (MainActivity's one call). */
@Composable
fun AppRoot(session: Session) {
    val book = LocalBook.current
    val settings by book.settings.value.collectAsStateWithLifecycle()
    val device by ThemeChoice.device.collectAsStateWithLifecycle()
    val lastShop by ThemeChoice.lastShop.collectAsStateWithLifecycle()
    val shopTheme = settings?.theme
    LaunchedEffect(shopTheme) { if (shopTheme != null) ThemeChoice.rememberShop(shopTheme) }

    val forced = ThemeChoice.preferredDark(device, shopTheme, lastShop)
    val dark = forced ?: isSystemInDarkTheme()
    ForcedNightMode(forced) {
        ErpTheme(themeOverride = when (forced) { true -> "taheri"; false -> "default"; null -> null }) {
            SystemBars(dark)
            // One toast for the whole app: the banner sits over every screen (the create sheet carries its own copy,
            // being a window of its own), so `LocalNoteState.current.show(Note(...))` works wherever it is called.
            val note = rememberNoteState()
            CompositionLocalProvider(LocalSession provides session, LocalNoteState provides note) {
                Box(Modifier.fillMaxSize()) {
                    RootGate()
                    NoteHost(note)
                    CrashReportDialog()
                }
                LockLayer()
            }
        }
    }
}

/**
 * Colours are resources that follow the device's day/night (ErpTheme reads them with colorResource), so a shop
 * set to light on a phone set to dark needs the resources of the other mode: a context whose configuration says so.
 */
@Composable
private fun ForcedNightMode(dark: Boolean?, content: @Composable () -> Unit) {
    if (dark == null) return content()
    val base = LocalContext.current
    val themed = remember(base, dark) {
        val cfg = Configuration(base.resources.configuration)
        val night = if (dark) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        cfg.uiMode = (cfg.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or night
        val res = base.createConfigurationContext(cfg).resources
        Triple(ResourcesContext(base, res), cfg, res)
    }
    CompositionLocalProvider(
        LocalContext provides themed.first,
        LocalConfiguration provides themed.second,
        LocalResources provides themed.third,
        content = content,
    )
}

/** The activity itself for everything that unwraps it, with other resources. */
private class ResourcesContext(base: Context, private val res: Resources) : ContextWrapper(base) {
    override fun getResources(): Resources = res
}

/** The status and navigation bars' icons follow the app's theme, not only the device's. */
@Composable
private fun SystemBars(dark: Boolean) {
    val view = LocalView.current
    SideEffect {
        val window = view.context.findActivity()?.window ?: return@SideEffect
        val c = WindowCompat.getInsetsController(window, view)
        c.isAppearanceLightStatusBars = !dark
        c.isAppearanceLightNavigationBars = !dark
    }
}

/** Signed in or not, owner or karigar: which app this person gets. */
@Composable
fun RootGate() {
    val session = LocalSession.current
    val state by session.state.collectAsStateWithLifecycle()
    val me by session.me.collectAsStateWithLifecycle()
    val page = when (state) {
        Session.State.Starting -> 0
        Session.State.SignedOut, Session.State.SigningIn, Session.State.NeedsSetup -> 1
        Session.State.SignedIn -> if (me?.role == "karigar") 2 else 3
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Crossfade(page, label = "gate") { p ->
            when (p) {
                0 -> StartingSkeleton()
                1 -> SignInScreen(session)
                // A karigar's own work, native (MyWorkScreen reads the portal's /api/karigar/me).
                2 -> KarigarHost()
                else -> RootScaffold()
            }
        }
    }
}

/**
 * Only while the ERP is asked who a new account is (Session opens on its last answer otherwise): the page's
 * outline on the ground the launch screen was drawn in.
 */
@Composable
private fun StartingSkeleton() {
    val bar = MaterialTheme.colorScheme.surfaceContainerHigh
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.fillMaxWidth().height(28.dp).background(bar, RoundedCornerShape(10.dp))) {}
        repeat(4) { Column(Modifier.fillMaxWidth().height(88.dp).background(bar, RoundedCornerShape(22.dp))) {} }
    }
}

@Composable
private fun KarigarHost() {
    // MyWorkScreen carries its own Refresh and Sign out, as the iPhone's does.
    val stack = rememberNavBackStack(Route("/my-work"))
    StackHost(stack)
}

/**
 * A back stack of ERP places drawn with Navigation 3: each tab has one, and the create sheet. Screens reach it
 * through `LocalNavigator`. `onClose` leaves a sheet from its first screen; `trailing` adds to the top bar of the root.
 */
@Composable
fun StackHost(
    stack: NavBackStack<NavKey>,
    modifier: Modifier = Modifier,
    onClose: (() -> Unit)? = null,
    trailing: (@Composable androidx.compose.foundation.layout.RowScope.() -> Unit)? = null,
) {
    val navigator = remember(stack, onClose) {
        object : Navigator {
            override fun open(path: String) {
                if ((stack.lastOrNull() as? Route)?.path != path) stack.add(Route(path, stack.size))
            }

            override fun replace(path: String) {
                if (stack.isEmpty()) return open(path)
                // Same depth as the one it replaces, so it keeps that place's state key.
                stack[stack.lastIndex] = Route(path, stack.lastIndex)
            }

            override fun back() {
                if (stack.size > 1) stack.removeAt(stack.lastIndex) else onClose?.invoke()
            }

            override val canGoBack: Boolean get() = stack.size > 1
        }
    }
    val reduce = erp.app.ui.reduceMotion()
    val density = androidx.compose.ui.platform.LocalDensity.current
    val motion = remember(reduce, density) { NavMotion(reduce, density) }
    CompositionLocalProvider(LocalNavigator provides navigator) {
        // The layout the shared elements travel in: a row opening a page morphs inside this stack, over its own pages.
        @OptIn(androidx.compose.animation.ExperimentalSharedTransitionApi::class)
        androidx.compose.animation.SharedTransitionLayout(modifier) {
            val shared = this
            NavDisplay(
                backStack = stack,
                modifier = Modifier.fillMaxSize(),
                onBack = { navigator.back() },
                sharedTransitionScope = shared,
                sizeTransform = null,
                transitionSpec = { motion.push(this) },
                popTransitionSpec = { motion.pop(this) },
                predictivePopTransitionSpec = { edge -> motion.predictivePop(this, edge) },
                entryProvider = { key ->
                    NavEntry(key) {
                        val scope = androidx.navigation3.ui.LocalNavAnimatedContentScope.current
                        val root = key == stack.firstOrNull()
                        val path = (key as Route).path
                        erp.app.ui.ProvideSharedScopes(shared, scope) {
                            RoundedOnExit(scope, enabled = !erp.app.ui.ZoomRegistry.morphs(path)) {
                                PlaceScreen(path, isRoot = root, onClose = if (root) onClose else null, trailing = if (root) trailing else null)
                            }
                        }
                    }
                },
            )
        }
    }
}

/** Covers the app while it is locked or being photographed for the recents screen. */
@Composable
private fun LockLayer() {
    val locked by erp.app.device.AppLock.locked.collectAsStateWithLifecycle()
    val covered by erp.app.device.AppLock.covered.collectAsStateWithLifecycle()
    val unlocking by erp.app.device.AppLock.unlocking.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity() as? androidx.fragment.app.FragmentActivity
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    if (locked || covered) {
        erp.app.device.LockCover(locked, unlocking) { activity?.let { a -> scope.launch { erp.app.device.AppLock.unlock(a) } } }
    }
}
