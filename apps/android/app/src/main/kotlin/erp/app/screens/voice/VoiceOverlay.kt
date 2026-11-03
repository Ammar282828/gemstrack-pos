package erp.app.screens.voice

import androidx.compose.ui.layout.onGloballyPositioned
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.platform.LocalLifecycleOwner
import erp.app.ErpApp
import erp.app.PageActivity
import erp.app.auth.LocalSession
import erp.app.auth.findActivity
import erp.app.config.House
import erp.app.data.LocalBook
import erp.app.screens.neworder.NewOrderPhoneStore
import erp.app.screens.sale.SaleStore
import erp.app.ui.Button
import erp.app.ui.FilledTonalButton
import erp.app.ui.IconButton
import erp.app.ui.MoneyFeedback
import erp.app.ui.TextButton
import erp.app.ui.Tone
import erp.app.ui.TextField
import erp.app.ui.color
import erp.app.ui.icons.Symbols
import kotlin.math.roundToInt

/** What the overlay drives (the model, or a stand-in in a test). */
interface VoiceDriver {
    fun open(language: String)
    fun close()
    fun pause()
    fun resume()
}

/**
 * Whether the voice capsule is up, and its model (the iPhone's `VoiceSession.shown` / `present` / `dismiss`). Process-wide
 * on purpose: each page is an Activity of its own (PageActivity), and every one of them draws the capsule from this one
 * state, so it stays up, listening, as pages open and close beneath it. The microphone closes only when no Activity of the
 * app is in front any more ([started] counts them: the one leaving stops after the one arriving has started).
 */
class VoiceOverlayState<M : VoiceDriver>(private val make: () -> M) {
    var model: M? by mutableStateOf(null)
        private set
    val shown: Boolean get() = model != null

    /** The language of the live words ("en-PK" / "ur-PK"). */
    var language by mutableStateOf("en-PK")

    private var started = 0

    /** Opens it, listening; a second call while it is up does nothing. */
    fun present(): M {
        model?.let { return it }
        val made = make()
        model = made
        made.open(language)
        return made
    }

    /** Puts it away: the microphone closes. */
    fun dismiss() {
        val gone = model ?: return
        model = null
        gone.close()
    }

    /** A business switch: whatever was being said belonged to the one left. */
    fun reset() = dismiss()

    /** An Activity came to the front. */
    fun activityStarted() {
        started += 1
        if (started == 1) model?.resume()
    }

    /** An Activity went away; the last one going behind the lock, the switcher or another app closes the microphone. */
    fun activityStopped() {
        started = (started - 1).coerceAtLeast(0)
        if (started == 0) model?.pause()
    }
}

/** The app's one overlay. "Talk to ERP" in every form (the create menu, the launcher shortcut, the tile, assist) lands in [present]. */
object VoiceOverlay {
    val state = VoiceOverlayState { VoiceModel(ErpApp.instance, ErpApp.scope) }

    /** The ERP path the create menu and the launch address name; opening it shows the capsule instead of a page. */
    fun handles(path: String): Boolean = path == VoiceLaunch.PATH

    fun present() { state.present() }

    /**
     * "Talk to ERP" asked for from outside a composition. Only an owner has voice; a cold start from the launcher tile asks
     * before the sign-in has been read, so the capsule is let up then and [VoiceOverlayHost] puts it away if the account is not one.
     */
    fun request() {
        val s = ErpApp.session
        if (s.state.value != erp.app.auth.Session.State.SignedIn || s.isOwner) present()
    }
    fun dismiss() = state.dismiss()
    fun reset() = state.reset()
}

/** Room under the capsule for what the screen keeps at its foot (the tab bar); set per Activity by the tabs. */
class VoiceInset {
    /** Above the shell's own bar (the tabs), set by the scaffold. */
    var bottom: Dp by mutableStateOf(72.dp)

    /** A page's bar at its foot (voiceClearance); the capsule clears the higher of the two. */
    var footer: Dp by mutableStateOf(0.dp)

    val clearance: Dp get() = if (footer > bottom) footer else bottom
}

val LocalVoiceInset = androidx.compose.runtime.compositionLocalOf { VoiceInset() }

/**
 * A page's own bar at its foot (an order's next step, an invoice's Take payment): the voice capsule rises above it instead of
 * covering its buttons (2026-11-03 screenshot), and goes back down when the bar leaves.
 */
@Composable
fun Modifier.voiceClearance(): Modifier {
    val inset = LocalVoiceInset.current
    val density = androidx.compose.ui.platform.LocalDensity.current
    androidx.compose.runtime.DisposableEffect(inset) {
        onDispose { inset.footer = 0.dp }
    }
    return this.then(Modifier.onGloballyPositioned { c ->
        val needed = with(density) { c.size.height.toDp() } + 8.dp
        if (inset.footer != needed) inset.footer = needed
    })
}

/**
 * The capsule over whatever is open, drawn by every Activity's shell (AppShell). The page beneath stays live: it scrolls, its
 * buttons work, and a page the plan opens is pushed over the page below, with the capsule still above it. Owners only.
 */
@Composable
fun VoiceOverlayHost() {
    // Counted for the whole app, not drawn: the microphone follows the app being in front, not one Activity.
    LifecycleEventEffect(Lifecycle.Event.ON_START) { VoiceOverlay.state.activityStarted() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { VoiceOverlay.state.activityStopped() }
    val session = LocalSession.current
    val owner = session.isOwner
    val signedIn by session.state.collectAsStateWithLifecycle()
    val voice = VoiceOverlay.state.model
    LaunchedEffect(owner, signedIn, voice) {
        if (!owner && signedIn == erp.app.auth.Session.State.SignedIn && voice != null) VoiceOverlay.dismiss()
    }
    if (voice == null || !owner) return
    // Only the Activity in front draws it (one is leaving as the next arrives).
    val state by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsStateWithLifecycle()
    if (!state.isAtLeast(Lifecycle.State.STARTED)) return
    val context = LocalContext.current
    val book = LocalBook.current
    LaunchedEffect(book) { book.customers.need(); book.products.need(); book.settings.need() }
    val focus by VoiceContext.current.collectAsStateWithLifecycle()
    val inset = LocalVoiceInset.current
    VoiceCapsule(
        voice = voice,
        focusLabel = focus?.label,
        language = VoiceOverlay.state.language,
        onLanguage = { VoiceOverlay.state.language = it; voice.setLanguage(it) },
        open = { path ->
            val activity = context.findActivity()
            if (path.startsWith("tel:")) {
                context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse(path)).also { if (activity == null) it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
            } else {
                PageActivity.start(activity ?: context, path)
            }
        },
        onClose = { VoiceOverlay.dismiss() },
        modifier = Modifier.fillMaxSize().navigationBarsPadding().imePadding().padding(bottom = inset.clearance),
    )
}

/**
 * The capsule itself: the orb, the words as they are heard, then the answer or what is about to be saved and its yes. Several
 * steps open it a little upward. surfaceContainerHighest, the expressive extraLarge corner, a floating toolbar's shadow. Closed
 * with ✕, a swipe down, or "no".
 */
@Composable
fun VoiceCapsule(
    voice: VoiceModel,
    focusLabel: String?,
    language: String,
    onLanguage: (String) -> Unit,
    open: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val book = LocalBook.current
    val person = LocalSession.current.shop.person
    var typing by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var menu by remember { mutableStateOf(false) }
    var drag by remember { mutableFloatStateOf(0f) }
    val unavailable = voice.failure != null && !voice.listening && !voice.starting && voice.plan == null
    val plan = voice.plan
    val formsReady = book.customers.loaded.collectAsStateWithLifecycle().value &&
        book.products.loaded.collectAsStateWithLifecycle().value && book.settings.loaded.collectAsStateWithLifecycle().value

    // A saved plan or a refusal has its own tap.
    MoneyFeedback(success = voice.completed, failure = voice.failure)

    fun fill(card: VoiceCard, path: String) {
        try {
            val payload = VoiceHandoff.payload(card.handoff)
            when (VoiceHandoff.kind(card.handoff)) {
                "order" -> NewOrderPhoneStore.save(
                    VoiceHandoff.order(payload, { book.customers.item(it) }, book.settings.value.value, person, House.metal, NewOrderPhoneStore.load()),
                )
                "sale" -> SaleStore.save(
                    VoiceHandoff.sale(
                        payload, book.customers.items.value, { book.customers.item(it) }, book.products.items.value,
                        person, House.metal, SaleStore.load(),
                    ),
                )
                else -> throw VoiceHandoff.Failure("Open the native form and enter the details shown above.")
            }
            // The form opens blank unless asked to continue (drafts, 2026-10-25): voice has just filled it, so ask.
            open(if ('?' in path) "$path&resume=1" else "$path?resume=1")
        } catch (e: Exception) {
            voice.failure = e.message ?: e.toString()
        }
    }

    Box(modifier.fillMaxWidth().padding(horizontal = 12.dp), contentAlignment = Alignment.BottomCenter) {
        Surface(
            // Highest, with a floating toolbar's shadow: it floats over the page's own tonal cards, and at the same tone with no
            // shadow it read as one more card (2026-11-03 screenshot). M3 lets floating controls (FAB, floating toolbar) cast one.
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            contentColor = MaterialTheme.colorScheme.onSurface,
            shape = MaterialTheme.shapes.extraLarge,
            shadowElevation = 6.dp,
            modifier = Modifier.widthIn(max = 560.dp).fillMaxWidth().offset { IntOffset(0, drag.roundToInt().coerceAtLeast(0)) }
                .animateContentSize()
                // A container a screen reader enters and leaves, named for what it is; the page beneath is still the person's.
                .semantics { contentDescription = "Voice assistant" },
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                voice.failure?.let { message -> FailureLine(message, voice.canRetry) { voice.retry() } }
                if (plan != null && VoiceLogic.showsSteps(plan, voice.completed)) {
                    Steps(plan, voice, formsReady, open, ::fill)
                }
                if (typing || unavailable) {
                    TypedField(typed, { typed = it }, enabled = !voice.thinking && !voice.writing) {
                        voice.submitTyped(typed)
                        typed = ""
                    }
                }
                // A swipe down on the row puts it away (on the row only: the steps above it scroll).
                Row(
                    Modifier.fillMaxWidth().pointerInput(Unit) {
                        detectVerticalDragGestures(
                            onDragEnd = { if (drag > 60.dp.toPx()) onClose(); drag = 0f },
                            onDragCancel = { drag = 0f },
                        ) { _, delta -> drag += delta }
                    },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Orb(voice)
                    Words(voice, focusLabel, unavailable, Modifier.weight(1f))
                    Box {
                        IconButton(onClick = { menu = true }, modifier = Modifier.semantics { contentDescription = "Voice options" }) {
                            Icon(Symbols.MoreVert, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(
                                text = { Text(if (typing) "Hide keyboard" else "Type instead") },
                                onClick = { menu = false; typing = !typing },
                            )
                            DropdownMenuItem(
                                text = { Text(if (voice.readAloud) "Stop reading aloud" else "Read answers aloud") },
                                onClick = { menu = false; voice.readAloud = !voice.readAloud; if (!voice.readAloud) voice.silence() },
                            )
                            for ((code, name) in VoiceLogic.languages) {
                                DropdownMenuItem(
                                    text = { Text(if (code == language) "Words: $name (on)" else "Words: $name") },
                                    onClick = { menu = false; onLanguage(code) },
                                )
                            }
                        }
                    }
                    IconButton(
                        onClick = onClose, enabled = !voice.writing,
                        modifier = Modifier.semantics { contentDescription = "Close voice" },
                    ) { Icon(Symbols.Close, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                if (plan != null && plan.ready && plan.operations.isNotEmpty() && voice.completed < plan.operations.size) {
                    DoIt(voice, plan)
                }
            }
        }
    }
}

/** The 44 dp orb: the mic, ringed by the voice's level while listening; a tap is "Done" (or listen again). */
@Composable
private fun Orb(voice: VoiceModel) {
    val active = voice.listening || voice.thinking || voice.writing
    val label = when {
        voice.thinking -> "Reading what you said"
        voice.listening -> if (voice.live.isBlank()) "Listening" else "Finish speaking"
        else -> "Listen again"
    }
    val scale = if (voice.listening) 1f + voice.level * 0.35f else 1f
    Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(44.dp).scale(scale).clip(CircleShape)
                .background(if (voice.listening) MaterialTheme.colorScheme.primary.copy(alpha = 0.25f) else Color.Transparent),
        )
        Box(
            Modifier.size(40.dp).clip(CircleShape)
                .background(if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer)
                .clickable(enabled = !voice.starting && !voice.thinking && !voice.writing, role = Role.Button) { voice.micTap(VoiceOverlay.state.language) }
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Symbols.Mic, null, Modifier.size(22.dp),
                tint = if (active) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer,
            )
        }
    }
}

@Composable
private fun Words(voice: VoiceModel, focusLabel: String?, unavailable: Boolean, modifier: Modifier) {
    val plan = voice.plan
    val headline = VoiceLogic.headline(plan, voice.completed)
    val status = VoiceLogic.status(
        starting = voice.starting, listening = voice.listening, writing = voice.writing, clipMode = voice.clipMode,
        plan = plan, completed = voice.completed, focusLabel = focusLabel, unavailable = unavailable,
    )
    Column(modifier.semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        when {
            voice.thinking -> {
                Text(voice.words.ifBlank { voice.live }.ifBlank { "Your recording" }, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("Reading it…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            voice.live.isNotBlank() ->
                // The newest words are the ones to see: an overflowing sentence loses its start.
                Text(voice.live, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.StartEllipsis)
            headline != null -> {
                Text(headline, style = MaterialTheme.typography.titleSmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
                Text(status, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            else -> Text(status, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun Steps(
    plan: VoicePlan,
    voice: VoiceModel,
    formsReady: Boolean,
    open: (String) -> Unit,
    fill: (VoiceCard, String) -> Unit,
) {
    Column(
        Modifier.fillMaxWidth().heightIn(max = 220.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val href = plan.href
        if (plan.answer != null && href != null) {
            FilledTonalButton(onClick = { open(href) }) { Text("Open page"); Spacer(Modifier.size(6.dp)); Icon(Symbols.ArrowOutward, null, Modifier.size(18.dp)) }
        }
        plan.cards.forEachIndexed { n, card ->
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (plan.cards.size > 1) Text("${n + 1}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(card.summary, style = MaterialTheme.typography.bodyMedium)
                }
                card.problem?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color()) }
                val path = card.href
                if (path != null && VoiceLogic.opensRecord(card)) {
                    FilledTonalButton(
                        onClick = { if (card.handoff == null) open(path) else fill(card, path) },
                        enabled = !voice.writing && formsReady,
                    ) { Text(if (card.handoff == null) "Open record" else "Fill the form") }
                }
            }
        }
        val last = plan.cards.lastOrNull()?.href
        if (plan.operations.isNotEmpty() && voice.completed == plan.operations.size && last != null) {
            FilledTonalButton(onClick = { open(last) }) { Text("Open record") }
        } else if (voice.completed > 0) {
            Text("${voice.completed} of ${plan.operations.size} changes saved.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun FailureLine(message: String, canRetry: Boolean, retry: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = Tone.problem.color())
        if (canRetry) TextButton(onClick = retry) { Text("Try again") }
    }
}

@Composable
private fun TypedField(value: String, onChange: (String) -> Unit, enabled: Boolean, send: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        TextField(
            value, onChange, Modifier.weight(1f).focusRequester(focus),
            placeholder = { Text("Type what you need…") }, maxLines = 3,
        )
        IconButton(onClick = send, enabled = enabled && value.isNotBlank(), modifier = Modifier.semantics { contentDescription = "Send" }) {
            Icon(Symbols.ArrowUpward, null)
        }
    }
}

/**
 * `/voice` reached as a page (the Hub's item column, a stack seeded with it): there is no page for it, only the capsule over
 * whatever is open, so it is shown and the page stepped back from. [PageActivity.start] answers the common routes before this.
 */
@Composable
fun VoiceOpener() {
    val navigator = erp.app.nav.LocalNavigator.current
    val owner = LocalSession.current.isOwner
    LaunchedEffect(Unit) {
        if (owner) VoiceOverlay.present()
        navigator.back()
    }
}

/** "Do it" and "Not now" when the plan is ready to save; the same as saying "yes" or "no". */
@Composable
private fun DoIt(voice: VoiceModel, plan: VoicePlan) {
    val saving = voice.writing
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (voice.completed == 0) TextButton(onClick = { voice.dismissPlan() }, enabled = !saving) { Text("Not now") }
        Spacer(Modifier.weight(1f))
        if (!saving) Text("Or say “yes”", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = { voice.save() }, enabled = !saving && !voice.thinking && voice.words == plan.reviewedWords) {
            Icon(Symbols.Check, null, Modifier.size(18.dp))
            Spacer(Modifier.size(6.dp))
            Text(if (saving) "Saving…" else if (voice.completed > 0) "Save the rest" else "Do it")
        }
    }
}
