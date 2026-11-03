package erp.app.screens.businesses

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.font.FontWeight
import erp.app.ui.TextButton
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.device.LaunchClock
import erp.app.ui.AppClock
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
 * The picker (BusinessPicker.swift, redone 2026-11-02 after the bands and four cards before them were turned down: owner, "more minimal
 * for choosing businesses, add two cards"). The page is the system's own surface, light or dark as the phone is, with one quiet heading,
 * "Choose a business". Each business is one card in its own identity colours (the same in light and dark): Taheri's champagne gold wordmark
 * on #0B1414, Mina's maroon on blush #F2E9E4, an added business's name on its dark accent. A card holds the wordmark and under it one tiny
 * line: who is signed in, or "Sign in", else the address. Cards are equal, centred in the screen's height, side by side from 600 dp wide
 * and stacked on a phone; the business used last comes first and carries a 6 dp dot. A press settles a card to 0.97, a tap gives one
 * haptic and the app takes the screen while the others fade. Adding and managing are two small text buttons at the foot. Material You is in
 * the card shape (extra large) and the type; everything is read locally, nothing waits on the network.
 */
@Composable
internal fun BusinessPicker(list: List<Business>, last: Business) {
    val haptics = rememberHaptics()
    val motion = rememberErpMotion()
    val ordered = remember(list, last.id) { BandLogic.ordered(list, last.id) }
    var chosen by remember { mutableStateOf<String?>(null) }
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }
    val shown by animateFloatAsState(if (entered) 1f else 0f, motion.effects(), label = "picker")

    fun pick(b: Business) {
        if (chosen != null) return
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

    BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        val sideBySide = maxWidth >= 600.dp
        // Centred in the screen's height: two cards at the top would leave the lower half empty.
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).heightIn(min = maxHeight)
                .windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 20.dp, vertical = 32.dp).alpha(shown),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
        ) {
            Column(Modifier.widthIn(max = if (sideBySide) 780.dp else 480.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                Text(
                    "Choose a business", Modifier.semantics { heading() },
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold),
                )
                if (sideBySide) {
                    // Rows of up to three equal cards.
                    for (row in ordered.chunked(3)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            for (b in row) Card(b, b.id == last.id, true, chosen, Modifier.weight(1f)) { pick(b) }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        for (b in ordered) Card(b, b.id == last.id, false, chosen, Modifier.fillMaxWidth()) { pick(b) }
                    }
                }
                // Adding and managing both live on the Businesses sheet, which this opens above the picker.
                Row(
                    Modifier.fillMaxWidth().alpha(if (chosen == null) 1f else 0f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.Start), verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (Businesses.canAdd) TextButton(Businesses::openSheet, enabled = chosen == null) { Text("Add a business", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    TextButton(Businesses::openSheet, enabled = chosen == null) { Text("Manage", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
        }
    }
}

@Composable
private fun Card(b: Business, last: Boolean, sideBySide: Boolean, chosen: String?, modifier: Modifier, onPick: () -> Unit) {
    val motion = rememberErpMotion()
    val id = BandLogic.identity(b)
    val ground = hexColor(id.ground)
    val ink = hexColor(id.ink)
    // Only from a Firebase app that already exists: asking would make one for a business that is not open, which is the launch's cost.
    val state = remember(b.id) { BandLogic.signIn(Businesses.firebaseAppMade(b), Businesses.signedInEmail(b, create = false)) }
    val status = BandLogic.status(b, last, state, Businesses.lastOpenedAt(b), AppClock.now())
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.97f else 1f, motion.spatial(), label = "press")
    // The card that was tapped stays; the rest fade while the app takes the screen.
    val fade by animateFloatAsState(if (chosen == null || chosen == b.id) 1f else 0f, motion.effects(), label = "fade")
    val shape = RoundedCornerShape(28.dp)
    Box(
        modifier
            .then(if (sideBySide) Modifier.aspectRatio(1.6f) else Modifier.height(130.dp))
            .graphicsLayer { scaleX = scale; scaleY = scale; alpha = fade }
            .clip(shape).background(ground)
            .clickable(interactionSource = source, indication = null, onClickLabel = "Open ${b.displayName}", role = Role.Button, enabled = chosen == null, onClick = onPick)
            .semantics(mergeDescendants = true) { contentDescription = "Open ${b.displayName}"; stateDescription = status },
    ) {
        Column(
            Modifier.align(Alignment.Center).padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Wordmark(b, ink)
            Text(
                BandLogic.caption(b, state), style = MaterialTheme.typography.labelSmall, color = ink.copy(alpha = 0.6f),
                maxLines = 1, overflow = TextOverflow.MiddleEllipsis, textAlign = TextAlign.Center,
            )
        }
        if (last) Box(Modifier.align(Alignment.TopEnd).padding(14.dp).size(6.dp).background(ink, CircleShape))
    }
}

/** A business's wordmark as a single tint: the bundled art for a built-in (single-colour PNGs, the card's ink colours them), else the name. */
@Composable
private fun Wordmark(b: Business, ink: Color) {
    val art = b.art
    if (art != null) {
        // Taheri 24 dp, the spaced capitals of M I N A 18 dp, so the two read as the same weight.
        val h = if (art == "mina") 18.dp else 24.dp
        Image(painterResource(logoRes(art)), null, Modifier.heightIn(max = h).widthIn(max = 200.dp), contentScale = ContentScale.Fit, colorFilter = ColorFilter.tint(ink))
    } else {
        Text(b.name, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold), color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
