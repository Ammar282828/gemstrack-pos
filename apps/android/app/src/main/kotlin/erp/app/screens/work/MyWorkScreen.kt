package erp.app.screens.work

import erp.app.ui.animatedItem
import erp.app.ui.icons.Symbols
import erp.app.ui.AppClock
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import erp.app.ui.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import erp.app.ui.OutlinedButton
import erp.app.ui.SegmentedButton
import erp.app.ui.SegmentedButtonDefaults
import erp.app.ui.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImageDecoder
import erp.app.ui.FailureAlert
import erp.app.ui.FigureRow
import erp.app.ui.FigureTile
import erp.app.ui.HeroAmount
import erp.app.ui.NotAvailableState
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.web.WebScreen
import erp.core.logic.KarigarPortal
import erp.core.logic.KarigarPortalAccount
import erp.core.logic.KarigarPortalGoldLine
import erp.core.logic.KarigarPortalGroup
import erp.core.logic.KarigarPortalJob
import erp.core.logic.KarigarPortalPayment
import erp.core.logic.KarigarPortalRules
import erp.core.logic.KarigarPortalSummary
import erp.core.logic.Money
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant

/** What the screen is showing: the first answer pending, the portal, "no work account", or a first answer that failed. */
private sealed interface Phase {
    data object Loading : Phase
    data object Ready : Phase
    data object NoAccount : Phase
    data class Failed(val message: String) : Phase
}

private enum class Pane(val title: String) { Work("My Work"), Account("My Account") }

/**
 * My work (src/app/my-work/page.tsx): a karigar's own portal. What to make, by order, oldest and most urgent first, with the
 * size, weight, finish and the instructions of each piece, a tick to say it is done; and their own account: the gold given
 * and returned, and what they were paid.
 *
 * Everything comes from /api/karigar/me, which the server fills by hand (no customer's name or number, no price ever reaches
 * a karigar; they have no Firestore either). The tick is /api/karigar/complete, which re-checks that the piece is theirs.
 * Re-read every minute and whenever the app comes back, as the web does.
 *
 * An owner reaches it from a karigar's page (`/my-work?preview=<karigar id>`): the same portal, read only, exactly as that
 * karigar sees it. Anyone else is told there is no work account: the page says the same.
 */
@Composable
fun MyWorkScreen(path: String) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val previewId = WorkPaths.query("preview", path)?.takeIf { it.isNotEmpty() }
    // A karigar's own app: this screen is all they have, so it carries their way out.
    val isKarigar = session.role == "karigar"

    var phase by remember { mutableStateOf<Phase>(Phase.Loading) }
    var portal by remember { mutableStateOf<KarigarPortal?>(null) }
    var updatedAt by remember { mutableStateOf<Instant?>(null) }
    var pane by rememberSaveable { mutableStateOf(Pane.Work) }
    // The piece whose tick is being sent.
    var busy by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var webPortal by remember { mutableStateOf(false) }

    suspend fun load() {
        if (House.isDemo) {
            portal = WorkDemo.portal()
            updatedAt = AppClock.now()
            phase = if (portal?.karigar == null) Phase.NoAccount else Phase.Ready
            return
        }
        try {
            val answer = ErpApi.shared.getModel<KarigarPortal>(WorkPaths.portal(previewId))
                ?: throw ErpApi.Failure(0, "The ERP sent something unexpected.")
            portal = answer
            updatedAt = AppClock.now()
            phase = if (answer.karigar == null) Phase.NoAccount else Phase.Ready
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 401 || e.status == 403) {
                // Not a karigar's address (the route answers an owner who named nobody the same way).
                portal = null
                phase = Phase.NoAccount
            } else if (portal == null) {
                // A dropped connection is no reason to blank the work on screen.
                phase = Phase.Failed(e.message)
            }
        } catch (e: Exception) {
            if (portal == null) phase = Phase.Failed(e.message ?: e.toString())
        }
    }

    // The web's focus handler and its minute timer: a karigar has no live link to the books.
    LaunchedEffect(previewId) {
        load()
        erp.app.device.LaunchClock.finish("work")
        while (true) {
            delay(60_000)
            load()
        }
    }
    var firstStart by remember { mutableStateOf(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (firstStart) firstStart = false else scope.launch { load() }
    }

    ScreenTitle(portal?.karigar?.name ?: "My work")
    ScreenActions {
        IconButton(onClick = { scope.launch { load() } }) { Icon(Symbols.Refresh, contentDescription = "Refresh") }
        if (isKarigar && portal?.preview != true) {
            IconButton(onClick = { session.signOut() }) { Icon(Symbols.Logout, contentDescription = "Sign out") }
        }
    }

    /** Says a piece is done, or not (idempotent: the server is told the state wanted, not "flip it"). */
    fun toggle(job: KarigarPortalJob) {
        if (busy != null || portal?.preview == true) return
        // Taken before the launch, so a double tap cannot pass the guard twice.
        busy = job.id
        scope.launch {
            try {
                ErpApi.shared.send("/api/karigar/complete", body = mapOf("jobId" to job.id, "completed" to !job.isDone))
                load()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e.message ?: e.toString()
            }
            busy = null
        }
    }

    Box(Modifier.fillMaxSize().background(ErpColors.ground)) {
        when (val p = phase) {
            Phase.Loading -> SkeletonLoading(Modifier.fillMaxSize())
            Phase.NoAccount -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                NotAvailableState("No work account found", why = "Ask the shop to add your Google address.", icon = Symbols.PersonSearch)
                if (isKarigar) OutlinedButton(onClick = { session.signOut() }) { Text("Sign out") }
            }
            is Phase.Failed -> Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                NotAvailableState("Couldn't load the work", why = p.message, icon = Symbols.WifiOff)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = { phase = Phase.Loading; scope.launch { load() } }) { Text("Try again") }
                    // A karigar has nothing else in the app: the ERP's own portal is the way through meanwhile.
                    if (isKarigar) OutlinedButton(onClick = { webPortal = true }) { Text("Open the web portal") }
                }
            }
            Phase.Ready -> portal?.let { Content(it, updatedAt, pane, { pane = it }, busy, ::toggle) }
        }
    }

    FailureAlert(failure, onDismiss = { failure = null }, title = "Could not update")
    if (webPortal) WebPortal(onClose = { webPortal = false })
}

// MARK: The portal

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Content(p: KarigarPortal, updatedAt: Instant?, pane: Pane, onPane: (Pane) -> Unit, busy: String?, toggle: (KarigarPortalJob) -> Unit) {
    val readOnly = p.preview
    val rules = remember(p) { KarigarPortalRules.sections(p.jobs) }
    val lateTone = Tone.late.color()
    val owedTone = Tone.owed.color()
    val quiet = MaterialTheme.colorScheme.onSurfaceVariant
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (readOnly) {
            p.karigar?.name?.let { name ->
                animatedItem(key = "preview") {
                    Text(
                        "Viewing exactly what $name sees. Read-only — tick items off from the Workshop dashboard instead.",
                        Modifier.readableColumn(820.dp).ledgerCard(),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        animatedItem(key = "figures") {
            Column(Modifier.readableColumn(820.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Figures(p.summary)
                if (updatedAt != null) {
                    Text(
                        "Updated ${MyWorkText.clock(updatedAt)} · refreshes automatically",
                        Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        animatedItem(key = "pane") {
            SingleChoiceSegmentedButtonRow(Modifier.readableColumn(820.dp).fillMaxWidth()) {
                Pane.entries.forEachIndexed { i, t ->
                    SegmentedButton(
                        selected = pane == t, onClick = { onPane(t) },
                        shape = SegmentedButtonDefaults.itemShape(i, Pane.entries.size),
                        label = { Text(t.title) },
                    )
                }
            }
        }
        when (pane) {
            Pane.Work -> {
                if (rules.active.isEmpty()) {
                    animatedItem(key = "none") {
                        Column(
                            Modifier.readableColumn(820.dp).ledgerCard(), horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Icon(Symbols.CheckCircle, null, Modifier.size(40.dp), tint = Tone.settled.color())
                            Text("No pending work", style = MaterialTheme.typography.titleMedium)
                            Text("Nothing is waiting for you at the bench.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                } else {
                    group("Urgent", rules.critical, Symbols.Whatshot, lateTone, "14+ days", readOnly, busy, toggle)
                    group("Late", rules.late, Symbols.Schedule, owedTone, "7–14 days", readOnly, busy, toggle)
                    group("In hand", rules.onTrack, null, quiet, "on track", readOnly, busy, toggle)
                }
                group("Completed", rules.done, Symbols.CheckCircle, quiet, null, readOnly, busy, toggle)
            }
            Pane.Account -> account(p.account)
        }
    }
}

/** To do, Late (a week or more) and Urgent (two weeks or more). */
@Composable
private fun Figures(s: KarigarPortalSummary) {
    FigureRow(spacing = 10.dp) {
        FigureTile("To do", "${s.active}", Modifier.share())
        FigureTile("Late", "${s.late}", Modifier.share(), tint = if (s.late > 0) Tone.owed.color() else Color.Unspecified, number = s.late.toDouble())
        FigureTile("Urgent", "${s.critical}", Modifier.share(), tint = if (s.critical > 0) Tone.late.color() else Color.Unspecified, number = s.critical.toDouble())
    }
}

/** One heading of the page and its orders, each order a card of its pieces. */
private fun androidx.compose.foundation.lazy.LazyListScope.group(
    title: String,
    jobs: List<KarigarPortalJob>,
    icon: ImageVector?,
    tone: Color,
    hint: String?,
    readOnly: Boolean,
    busy: String?,
    toggle: (KarigarPortalJob) -> Unit,
) {
    if (jobs.isEmpty()) return
    animatedItem(key = "h-$title") {
        Row(
            Modifier.readableColumn(820.dp).padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) Icon(icon, null, Modifier.size(18.dp), tint = tone)
            Text(title.uppercase(), style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold), color = tone)
            Text("${jobs.size}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Box(Modifier.weight(1f))
            if (hint != null) Text(hint, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    for (g in KarigarPortalRules.groups(jobs)) {
        animatedItem(key = "g-$title-${g.key}") {
            Column(Modifier.readableColumn(820.dp).ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OrderHeader(g)
                g.jobs.forEach { j -> PieceRow(j, readOnly, busy, toggle) }
            }
        }
    }
}

/**
 * The heading a karigar works from: the order's number (or "Stock piece"), how many pieces, when they were given and how
 * long ago, and a badge once it is a week old.
 */
@Composable
private fun OrderHeader(g: KarigarPortalGroup) {
    val allDone = g.jobs.all { it.isDone }
    val n = g.jobs.size
    val given = KarigarPortalRules.date(g.assignedDate)
    val pieces = "$n piece" + (if (n == 1) "" else "s")
    val handed = if (given.isEmpty()) "" else " · given $given"
    val age = " · ${g.ageDays} day" + (if (g.ageDays == 1) "" else "s") + " ago"
    Row(Modifier.fillMaxWidth().alpha(if (allDone) 0.55f else 1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (g.isStock) {
                Text("Stock piece", style = MaterialTheme.typography.titleMedium)
            } else {
                Text(g.orderId ?: "", style = MaterialTheme.typography.titleMedium.copy(fontFamily = FontFamily.Monospace))
            }
            Text(pieces + handed + age, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!allDone && g.urgency != "ok") Pill("${g.ageDays}d", tone = if (g.urgency == "critical") Tone.late else Tone.owed)
    }
}

@Composable
private fun PieceRow(j: KarigarPortalJob, readOnly: Boolean, busy: String?, toggle: (KarigarPortalJob) -> Unit) {
    Row(Modifier.fillMaxWidth().alpha(if (j.isDone) 0.6f else 1f), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Tick(j, readOnly, busy, toggle)
        Column(Modifier.weight(1f).padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                j.description,
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium),
                textDecoration = if (j.isDone) TextDecoration.LineThrough else null,
            )
            Specs(j)
            if (j.sampleGiven) Pill("Sample provided", tone = Tone.quiet)
            j.sampleImage?.takeIf { it.isNotEmpty() }?.let { SamplePhoto(it, j.id) }
            j.notes?.takeIf { it.isNotEmpty() }?.let { notes ->
                Column(
                    Modifier.fillMaxWidth().clip(Radius.thumbShape).background(Tone.owed.color().copy(alpha = 0.1f)).padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text("INSTRUCTIONS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(notes, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun Tick(j: KarigarPortalJob, readOnly: Boolean, busy: String?, toggle: (KarigarPortalJob) -> Unit) {
    val box = Modifier.size(48.dp)
    when {
        busy == j.id -> Box(box, contentAlignment = Alignment.Center) { SkeletonLoading(Modifier.size(28.dp), compact = true) }
        readOnly -> Box(box.semantics { contentDescription = if (j.isDone) "Done" else "Not done" }, contentAlignment = Alignment.Center) {
            Icon(
                if (j.isDone) Symbols.CheckCircle else Symbols.RadioButtonUnchecked, null, Modifier.size(28.dp),
                tint = if (j.isDone) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
            )
        }
        else -> IconButton(onClick = { toggle(j) }, modifier = box) {
            Icon(
                if (j.isDone) Symbols.CheckCircle else Symbols.RadioButtonUnchecked,
                contentDescription = if (j.isDone) "Done. Tap to reopen." else "Mark as done",
                Modifier.size(28.dp),
                tint = if (j.isDone) Tone.settled.color() else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** Size, weight, finish, type, karat, reference, quantity: the boxes under a piece; size and finish stand out. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Specs(j: KarigarPortalJob) {
    val list = remember(j) { KarigarPortalRules.specs(j) }
    if (list.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (spec in list) {
            val accent = ErpColors.accent
            Column(
                Modifier.widthIn(min = 92.dp).clip(Radius.thumbShape)
                    .background(if (spec.accent) accent.copy(alpha = 0.12f) else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.1f))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(spec.label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    spec.value, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = if (spec.accent) accent else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

/** A piece's sample picture as the ERP holds it, a base64 data address: decoded once, off the main thread, shrunk to the screen. */
@Composable
private fun SamplePhoto(uri: String, key: String) {
    val bitmap by produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, key, uri.length) {
        value = withContext(kotlinx.coroutines.Dispatchers.Default) { StockImageDecoder.bitmap(uri, 1200)?.asImageBitmap() }
    }
    bitmap?.let {
        Image(
            it, contentDescription = "Sample picture", contentScale = ContentScale.Fit,
            modifier = Modifier.heightIn(max = 220.dp).clip(Radius.thumbShape),
        )
    }
}

// MARK: My Account

private fun androidx.compose.foundation.lazy.LazyListScope.account(a: KarigarPortalAccount) {
    animatedItem(key = "gold") {
        Column(Modifier.readableColumn(820.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionLabel(Symbols.Scale, "Gold")
            FigureRow(spacing = 10.dp) {
                FigureTile("Received", KarigarPortalRules.grams(a.goldGiven), Modifier.share())
                FigureTile("Returned", KarigarPortalRules.grams(a.goldReceived), Modifier.share())
                FigureTile("With you", KarigarPortalRules.grams(a.goldNet), Modifier.share(), tint = if (a.goldNet > 0) Tone.owed.color() else Color.Unspecified)
            }
            if (a.ledger.isNotEmpty()) {
                Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) { a.ledger.forEach { GoldRow(it) } }
            }
        }
    }
    animatedItem(key = "paid") {
        Column(Modifier.readableColumn(820.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionLabel(Symbols.Payments, "Payments received")
            Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    HeroAmount(a.totalPaid)
                    Text("total paid to you", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                a.payments.forEach { PaymentRow(it) }
            }
        }
    }
}

@Composable
private fun SectionLabel(icon: ImageVector, title: String) {
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun GoldRow(l: KarigarPortalGoldLine) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(KarigarPortalRules.date(l.date, shortYear = true), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(l.description, style = MaterialTheme.typography.bodyMedium)
        }
        Text(
            if (l.goldOut != 0.0) "↑ " + KarigarPortalRules.grams(l.goldOut) else "↓ " + KarigarPortalRules.grams(l.goldIn),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = erp.app.ui.theme.TabularDigits),
            color = if (l.goldOut != 0.0) Tone.owed.color() else Tone.settled.color(),
        )
    }
}

@Composable
private fun PaymentRow(p: KarigarPortalPayment) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text(KarigarPortalRules.date(p.date, shortYear = true), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(p.description, style = MaterialTheme.typography.bodyMedium)
        }
        Text(
            Money.grouped(p.amount),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold, fontFeatureSettings = erp.app.ui.theme.TabularDigits),
        )
    }
}

/** The ERP's own portal page, when the native one cannot be reached (a karigar has nothing else in the app). */
@Composable
private fun WebPortal(onClose: () -> Unit) {
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().statusBarsPadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onClose) { Icon(Symbols.ArrowBack, "Back") }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) { WebScreen("/") }
            }
        }
    }
}
