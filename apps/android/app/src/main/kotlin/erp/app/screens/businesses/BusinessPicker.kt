package erp.app.screens.businesses

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.device.LaunchClock
import erp.app.ui.AppClock
import erp.app.ui.IconButton
import erp.app.ui.icons.Symbols
import erp.app.ui.rememberErpMotion
import erp.app.ui.rememberHaptics

/**
 * The cold start's first screen when this phone holds two or more businesses: which one to enter (owner, 2026-10-20: "it should boot up
 * and ask me which business I want to enter"; BusinessPicker.swift). It is on by default and sits above the app, which loads the last
 * business's books underneath while the person decides: the app is not built in the picker's first frame ([mountsApp]). It lives for the
 * process, not the Activity, so a switch (which rebuilds every Activity) never brings it back; the lock cover is a window above it, so
 * the fingerprint still guards the list.
 */
object LaunchPicker {
    /** Whether a cold start asks at all: not in the demo, not when switched off in Settings → Businesses, not with a single business. */
    fun skips(demo: Boolean, ask: Boolean, count: Int): Boolean = demo || !ask || count < 2

    private var started = false
    private var startId = ""

    private var dismissed by mutableStateOf(false)

    /** The picker has painted: the open business's screens may now be built underneath. */
    var ready by mutableStateOf(false)

    /** Decides, once per process, whether this launch asks. */
    fun begin() = begin(Businesses.currentFlow.value.id, skips(House.isDemo, Businesses.askAtLaunch, Businesses.list.value.size))

    @Synchronized
    internal fun begin(openId: String, skip: Boolean) {
        if (started) return
        started = true
        startId = openId
        dismissed = skip
        ready = skip
    }

    /** A new process (the tests). */
    @Synchronized
    internal fun startOver() {
        started = false
        startId = ""
        dismissed = false
        ready = false
    }

    /**
     * Whether the picker is up. Any other business being open than the one that was at launch means a switch happened (a band, the chip,
     * the add sheet) and the picker has nothing left to ask.
     */
    fun showing(openId: String, count: Int): Boolean = !dismissed && openId == startId && count > 1

    /** The app itself is built only once the picker has painted: its first pass is the picker alone, so it paints at once. */
    fun mountsApp(openId: String, count: Int): Boolean = ready || !showing(openId, count)

    fun dismiss() {
        dismissed = true
        ready = true
    }
}

/** The picker over the app while it is up, and the app's own build after it has painted. */
@Composable
fun LaunchPickerLayer(app: @Composable () -> Unit) {
    LaunchPicker.begin()
    val list by Businesses.list.collectAsStateWithLifecycle()
    val open by Businesses.currentFlow.collectAsStateWithLifecycle()
    val showing = LaunchPicker.showing(open.id, list.size)
    if (LaunchPicker.mountsApp(open.id, list.size)) app()
    AnimatedVisibility(visible = showing, exit = fadeOut()) {
        BusinessPicker(list, open)
    }
    if (showing) {
        LaunchedEffect(Unit) {
            LaunchClock.mark("picker:shown")
            // Let this frame reach the screen, then build the open business underneath while the person decides.
            withFrameNanos { }
            withFrameNanos { }
            kotlinx.coroutines.delay(50)
            LaunchPicker.ready = true
        }
    }
}

/**
 * The picker as brand bands (BusinessPicker.swift, redone 2026-10-30 after three card versions were turned down): no cards. The screen is
 * cut into one full-bleed band per business, the colour running under the bars while the words keep to the safe area: two businesses are
 * two halves, up to four equal bands, more scroll at a quarter each. A band is the house's own identity, the same in light and dark:
 * Taheri's champagne gold wordmark on #0B1414, Mina's maroon on blush #F2E9E4, an added business's name on its dark accent. Under the
 * wordmark one tiny line (who is signed in, or "Sign in", else the address); the business used last has a dot beside it and comes first.
 * A tap grows the band over the rest while its words fade, with one haptic. Material You is in the joints only: the bands sit 4 dp apart
 * and the corners between them are extra large. Everything is read locally; nothing waits on the network.
 */
@Composable
internal fun BusinessPicker(list: List<Business>, last: Business) {
    val haptics = rememberHaptics()
    val motion = rememberErpMotion()
    val ordered = remember(list, last.id) { BandLogic.ordered(list, last.id) }
    var chosen by remember { mutableStateOf<String?>(null) }
    val topDark = ordered.firstOrNull()?.let { BandLogic.identity(it).isDark } ?: true
    // The status bar sits over the top band: light icons over a dark one, dark over a light one; handed back when the picker leaves.
    val view = LocalView.current
    DisposableEffect(topDark) {
        val window = (view.context as? android.app.Activity)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val before = controller?.isAppearanceLightStatusBars
        controller?.isAppearanceLightStatusBars = !topDark
        onDispose { if (controller != null && before != null) controller.isAppearanceLightStatusBars = before }
    }
    val insets = WindowInsets.safeDrawing.asPaddingValues()
    BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        val scrolls = ordered.size > BandLogic.FIT
        val each = maxHeight / minOf(ordered.size, BandLogic.FIT)
        Column(
            Modifier.fillMaxSize().then(if (scrolls) Modifier.verticalScroll(rememberScrollState()) else Modifier),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for ((i, b) in ordered.withIndex()) {
                // The chosen band's share stays, the others' go to nothing: it grows over them.
                val share by animateFloatAsState(if (chosen == null || chosen == b.id) 1f else 0.0001f, motion.spatial(), label = "band")
                val first = i == 0
                val end = i == ordered.size - 1
                val shape = RoundedCornerShape(
                    topStart = if (first) 0.dp else 28.dp, topEnd = if (first) 0.dp else 28.dp,
                    bottomStart = if (end) 0.dp else 28.dp, bottomEnd = if (end) 0.dp else 28.dp,
                )
                Band(
                    b, last = b.id == last.id, shape = shape, visible = chosen == null,
                    top = if (first) insets.calculateTopPadding() else 0.dp,
                    bottom = if (end) insets.calculateBottomPadding() else 0.dp,
                    footer = end,
                    modifier = (if (scrolls) Modifier.height(each) else Modifier.weight(share)).fillMaxWidth(),
                ) {
                    if (chosen != null) return@Band
                    haptics.selection()
                    Businesses.stampOpened(b)
                    LaunchClock.mark("picked", b.id)
                    // A launch whose books were still on their way when the person chose ends here ("picker"): the wait was theirs.
                    LaunchClock.finish("picker")
                    // One switch, then the picker leaves in the same change: the Activities are rebuilt on the new business, and this state lives above them.
                    chosen = b.id
                    if (b.id != last.id) Businesses.switchTo(b.id)
                    LaunchPicker.dismiss()
                }
            }
        }
    }
}

@Composable
private fun Band(
    b: Business, last: Boolean, shape: RoundedCornerShape, visible: Boolean, top: Dp, bottom: Dp, footer: Boolean,
    modifier: Modifier, onPick: () -> Unit,
) {
    val motion = rememberErpMotion()
    val id = BandLogic.identity(b)
    val ground = hexColor(id.ground)
    val ink = hexColor(id.ink)
    // Only from a Firebase app that already exists: asking would make one for a business that is not open, which is the launch's cost.
    val state = remember(b.id) { BandLogic.signIn(Businesses.firebaseAppMade(b), Businesses.signedInEmail(b, create = false)) }
    val status = BandLogic.status(b, last, state, Businesses.lastOpenedAt(b), AppClock.now())
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }
    val words by animateFloatAsState(if (entered && visible) 1f else 0f, motion.effects(), label = "words")
    Box(
        modifier.clip(shape).background(ground)
            .clickable(onClickLabel = "Open ${b.displayName}", role = Role.Button, onClick = onPick)
            .semantics(mergeDescendants = true) { contentDescription = "Open ${b.displayName}"; stateDescription = status },
    ) {
        Column(
            Modifier.align(Alignment.Center).padding(start = 24.dp, end = 24.dp, top = top, bottom = bottom).alpha(words),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Wordmark(b, ink)
            // The dot sits beside the line, balanced by a spacer so the line stays centred under the wordmark.
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (last) Box(Modifier.size(4.dp).background(ink, CircleShape)) else Spacer(Modifier.size(4.dp))
                Spacer(Modifier.size(6.dp))
                Text(BandLogic.caption(b, state), style = MaterialTheme.typography.labelSmall, color = ink.copy(alpha = 0.55f), maxLines = 1, overflow = TextOverflow.MiddleEllipsis, textAlign = TextAlign.Center, modifier = Modifier.weight(1f, fill = false))
                Spacer(Modifier.size(10.dp))
            }
        }
        if (footer) {
            // Adding and managing both live on the Businesses sheet, which this opens above the picker.
            Row(Modifier.align(Alignment.BottomEnd).padding(bottom = bottom + 4.dp, end = 8.dp).alpha(words)) {
                if (Businesses.canAdd) IconButton(Businesses::openSheet) { Icon(Symbols.Add, "Add a business", tint = ink.copy(alpha = 0.55f)) }
                IconButton(Businesses::openSheet) { Icon(Symbols.Tune, "Manage businesses", tint = ink.copy(alpha = 0.55f)) }
            }
        }
    }
}

/** A business's wordmark as a single tint: the bundled art for a built-in (single-colour PNGs, the band's ink colours them), else the name. */
@Composable
private fun Wordmark(b: Business, ink: Color) {
    val art = b.art
    if (art != null) {
        // Taheri 28 dp, the spaced capitals of M I N A 22 dp, so the two read as the same weight.
        val h = if (art == "mina") 22.dp else 28.dp
        Image(painterResource(logoRes(art)), null, Modifier.heightIn(max = h).widthIn(max = 240.dp), contentScale = ContentScale.Fit, colorFilter = ColorFilter.tint(ink))
    } else {
        Text(b.name, style = MaterialTheme.typography.headlineSmall, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
