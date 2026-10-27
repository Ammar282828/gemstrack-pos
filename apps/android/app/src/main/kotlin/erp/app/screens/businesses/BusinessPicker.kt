package erp.app.screens.businesses

import erp.app.ui.icons.Symbols
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.withFrameNanos
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.device.LaunchClock
import erp.app.ui.theme.ErpType
import erp.app.ui.appearOnce
import erp.app.ui.ledgerCard
import erp.app.ui.morphCard
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
     * Whether the picker is up. Any other business being open than the one that was at launch means a switch happened (a card, the chip,
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

@Composable
internal fun BusinessPicker(list: List<Business>, last: Business) {
    val haptics = rememberHaptics()
    // Only from a Firebase app that already exists: asking would make one for a business that is not open, which is the launch's cost.
    val emails = list.associate { it.id to Businesses.signedInEmail(it, create = false) }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 560.dp).padding(horizontal = 20.dp, vertical = 32.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Open", Modifier.padding(top = 32.dp, bottom = 10.dp).semantics { contentDescription = "Open which business" }, style = ErpType.heroNumber)
            for ((i, b) in list.withIndex()) {
                Row(
                    Modifier.fillMaxWidth().appearOnce(i)
                        .morphCard(onClickLabel = "Open ${b.displayName}", onClick = {
                            haptics.selection()
                            LaunchClock.mark("picked", b.id)
                            // A launch whose books were still on their way when the person chose ends here ("picker"): the wait was theirs.
                            LaunchClock.finish("picker")
                            // One switch, then the picker leaves in the same change: the Activities are rebuilt on the new business, and this state lives above them.
                            LaunchPicker.dismiss()
                            if (b.id != last.id) Businesses.switchTo(b.id)
                        })
                        .padding(22.dp).heightIn(min = 72.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BusinessBadge(b, size = 56.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(b.displayName, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        emails[b.id]?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        if (b.id == last.id) Text("Last opened", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Symbols.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (Businesses.canAdd) {
                TextButton(onClick = Businesses::openSheet, Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Symbols.Add, null)
                    Text("Add a business", Modifier.padding(start = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
