package erp.app.screens.marketing

import erp.app.ui.zoomSource
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.TrendingUp
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Camera
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.nav.LocalNavigator
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerHeading
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.TwoLine
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.launch

/**
 * Posts → Hub (src/app/posts/page.tsx): what went out today, where Taheri's gold post is, what waits in the queue, and
 * the website's pieces. A queued piece opens natively to be sent, held, timed or removed (PostQueueSheet: where it goes
 * is said in full before it goes); the whole queue is sent at once or spread over the day (PostQueueSpreadSheet). Pick,
 * caption and send is the tray (PostTrayScreen). Nothing here opens the ERP's web page.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PostsHub() {
    ScreenTitle("Posts")
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val state by PostsStore.state.collectAsStateWithLifecycle()
    val hasInvestments = MarketingKit.has("/website/investments", role)
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    var showAllToday by rememberSaveable { mutableStateOf(false) }
    var opened by remember { mutableStateOf<String?>(null) }
    var spreading by remember { mutableStateOf(false) }
    var confirmingAll by remember { mutableStateOf(false) }
    var sendingAll by remember { mutableStateOf(false) }
    val note = erp.app.ui.LocalNoteState.current

    LaunchedEffect(hasInvestments) { PostsStore.load(gold = hasInvestments) }

    val left: List<@Composable () -> Unit> = listOf(
        { MakeSection(role) },
        { FailingSection(state) },
        { TodaySection(state, showAllToday) { showAllToday = !showAllToday } },
        { if (hasInvestments) GoldSection(state) },
    )
    val right: List<@Composable () -> Unit> = listOf(
        { QueueSection(state, sendingAll, onSpread = { spreading = true }, onSendAll = { confirmingAll = true }) { opened = it } },
        { SiteSection(state, hasInvestments) },
    )

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; PostsStore.load(gold = hasInvestments); refreshing = false } },
        modifier = Modifier.fillMaxSize(),
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            if (maxWidth >= 840.dp) {
                // A tablet reads the day on the left and the queue and the website on the right.
                Row(Modifier.fillMaxSize().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) { left.forEach { it() } }
                    Column(Modifier.weight(1f).fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) { right.forEach { it() } }
                }
            } else {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    left.forEach { it() }
                    right.forEach { it() }
                }
            }
        }
    }

    opened?.let { id -> PostQueueSheet(id = id, onClose = { opened = null }) }
    if (spreading) PostQueueSpreadSheet(onDone = { note.show(it) }, onClose = { spreading = false })
    if (confirmingAll) {
        val waiting = state.waiting.size
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { confirmingAll = false },
            title = { Text(if (waiting > 1) "Send all $waiting pieces now?" else "Send it now?") },
            text = { Text(sendAllWords(state)) },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    confirmingAll = false
                    val n = state.waiting.size
                    if (n > 0) {
                        note.show(erp.app.ui.Note("Sending $n ${if (n == 1) "piece" else "pieces"}…", "It says here when they have gone."))
                        // In the app's own scope (the iPhone's Outbox): the hub is free at once; "sendNow" only sends what has not
                        // gone, so sending again after a failure posts nothing twice.
                        erp.app.ErpApp.scope.launch {
                            val (sent, of) = PostsStore.sendAll()
                            val whole = sent == of
                            note.show(
                                erp.app.ui.Note(
                                    if (whole) "All $of sent" else "$sent of $of sent",
                                    if (whole) "" else "The ones that failed say why; sending again sends only what didn't go.", failed = !whole,
                                ),
                            )
                        }
                    }
                }) { Text(if (state.failingChecks.isEmpty()) "Send" else "Send anyway") }
            },
            dismissButton = { androidx.compose.material3.TextButton(onClick = { confirmingAll = false }) { Text("Not yet") } },
        )
    }
}

/** Each piece and where it goes, in the order they go, and what is failing now (queue-panel.tsx's confirm). */
fun sendAllWords(state: PostsState): String {
    var out = state.waiting.joinToString("\n") { "• ${it.headline.ifEmpty { "Untitled" }} → ${state.queueWhere(it)}" }
    out += "\n\nOne after another, in this order. A post can't be unsent from here."
    val failing = state.failingChecks
    if (failing.isNotEmpty()) out += "\n\nThis will probably fail:\n" + failing.joinToString("\n") { "${it.label}: ${it.fix ?: it.detail}" }
    return out
}

/** Rows on the house's card with a hairline between them. */
@Composable
internal fun RowsCard(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) { DividedColumn { content() } }
}

@Composable
private fun Titled(title: String, footer: String? = null, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading(title, Modifier.padding(horizontal = 4.dp))
        content()
        if (footer != null) Text(footer, Modifier.padding(horizontal = 4.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

// MARK: Make a post

@Composable
private fun MakeSection(role: String) {
    val hasInvestments = MarketingKit.has("/website/investments", role)
    val hasWebsite = MarketingKit.has("/website/photos", role)
    RowsCard {
        if (hasInvestments) MarketingLink("Investments", Icons.AutoMirrored.Filled.TrendingUp, "/website/investments")
        MarketingLink("Pick, caption and send", Icons.AutoMirrored.Filled.Send, MarketingKit.trayPath())
        if (hasWebsite) MarketingLink("The website", Icons.Filled.Public, MarketingKit.websitePath)
    }
}

// MARK: The posting lines

/** A broken line is seen before anything is sent (the web's checks strip): only what has failed. */
@Composable
private fun FailingSection(state: PostsState) {
    val failing = state.failingChecks
    if (failing.isEmpty()) return
    // The connection checks stay folded until tapped, even when something fails (owner, 2026-10-23).
    var open by rememberSaveable { mutableStateOf(false) }
    RowsCard {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClickLabel = if (open) "Fold the checks" else "Show the checks") { open = !open }.ledgerRow(),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = Tone.owed.color())
            Text(
                "${failing.size} ${if (failing.size == 1) "thing needs" else "things need"} attention", Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium), color = Tone.owed.color(),
            )
            Icon(
                if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, contentDescription = if (open) "Fold" else "Unfold",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (open) {
            for (c in failing) {
                Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                    Icon(Icons.Filled.Warning, contentDescription = null, tint = Tone.owed.color())
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${c.group}: ${c.label}", style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                        Text(c.fix ?: c.detail, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

// MARK: Today

@Composable
private fun TodaySection(state: PostsState, showAll: Boolean, toggle: () -> Unit) {
    val today = state.sentToday()
    val footer = today.firstOrNull()?.let { "${today.size} out · last ${MarketingTime.clock(it.at)}" }
    Titled("Today", footer) {
        RowsCard {
            when {
                state.sent == null -> {
                    val problem = state.sentError
                    if (problem != null) Text(problem, Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else MarketingReading("Reading what went out…")
                }
                today.isEmpty() -> QuietDay(state)
                else -> {
                    for (s in if (showAll) today else today.take(4)) SentRow(s, state)
                    if (today.size > 4) ActionRow(if (showAll) "Fewer" else "${today.size - 4} more today", toggle)
                }
            }
        }
    }
}

@Composable
private fun QuietDay(state: PostsState) {
    val earlier = state.lastEarlier()
    val words = if (earlier != null) {
        val what = earlier.title.ifEmpty { "a post" }
        "Nothing out yet. The last was $what, ${MarketingTime.weekday(earlier.at)} at ${MarketingTime.clock(earlier.at)}."
    } else "Nothing in the last two days."
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Schedule, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(words, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun SentRow(s: PostSent, state: PostsState) {
    val places = s.destinations.joinToString(", ") { state.placeName(it) }
    val storyOnly = "instagram-story" in s.destinations && s.destinations.none { it.startsWith("whatsapp") }
    val title = s.title.ifEmpty { if (storyOnly) "A story" else "A post" }
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        val piece = s.sitePiece?.let { state.piece(it) }
        if (piece != null) {
            StockImage(piece.thumb, piece.name, piece.id, Modifier.size(44.dp).clip(Radius.thumbShape))
        } else {
            Box(Modifier.size(44.dp).clip(Radius.thumbShape).background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
                Icon(if (storyOnly) Icons.Filled.Camera else Icons.Filled.Forum, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        TwoLine(title, Modifier.weight(1f), subtitle = places, trailing = MarketingTime.clock(s.at))
    }
}

// MARK: Taheri's gold post

@Composable
private fun GoldSection(state: PostsState) {
    Titled("Investments") {
        RowsCard {
            MarketingLink("Gold post", Icons.AutoMirrored.Filled.TrendingUp, "/website/investments", goldLine(state))
        }
    }
}

/** Each part sent (at what time) or waiting; before the routine files it, the web's own line. */
fun goldLine(state: PostsState): String {
    val post = state.gold ?: return "Not here yet: the routine files it after 11:00."
    return state.goldParts.joinToString(" · ") { t ->
        val name = PostsStore.goldWords[t] ?: t
        post.sent[t]?.let { "$name ${MarketingTime.clock(it)}" } ?: "$name waiting"
    }
}

// MARK: The queue

@Composable
private fun QueueSection(state: PostsState, sendingAll: Boolean, onSpread: () -> Unit, onSendAll: () -> Unit, open: (String) -> Unit) {
    val items = state.queueShown()
    if (items.isEmpty()) return
    Titled("In the queue") {
        RowsCard {
            for (e in items) QueueRow(e, state) { open(e.id) }
            val waiting = state.waiting.size
            if (waiting > 0) {
                ActionRow("Spread over the day", onSpread, Icons.Filled.Schedule, enabled = !sendingAll)
                ActionRow(if (sendingAll) "Sending…" else if (waiting > 1) "Send all $waiting now" else "Send it now", onSendAll, Icons.AutoMirrored.Filled.Send, enabled = !sendingAll)
            }
        }
    }
}

/** Opens the piece: where it goes, word for word, and Send now, Hold, a time or Remove. */
@Composable
private fun QueueRow(e: PostQueueEntry, state: PostsState, open: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = open).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        StockImage(e.thumb, e.headline, e.id, Modifier.size(44.dp).clip(Radius.thumbShape), decodeDataUri = true)
        TwoLine(e.headline.ifEmpty { "A piece" }, Modifier.weight(1f), subtitle = queueNote(e, state))
        QueueBadge(e)
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
    }
}

fun queueNote(e: PostQueueEntry, state: PostsState): String {
    val places = state.queueWhere(e)
    return when (e.status) {
        "scheduled" -> "${ShopDate.say(e.dueAt, withTime = true)} · $places"
        "failed" -> e.lastError ?: "It did not all go. $places"
        "sent" -> "Sent ${MarketingTime.clock(e.sentAt)} · $places"
        else -> places
    }
}

/** Sent is the expected end: no tag, the line already says when (the iPhone's rule 15). */
@Composable
fun QueueBadge(e: PostQueueEntry) {
    val (words, tone) = when (e.status) {
        "scheduled" -> "Scheduled" to Tone.working
        "sending" -> "Sending" to Tone.owed
        "sent" -> return
        "failed" -> "Failed" to Tone.problem
        "draft" -> "Making" to Tone.quiet
        else -> "Held" to Tone.quiet
    }
    Pill(words, tone = tone)
}

// MARK: The website's pieces

@Composable
private fun SiteSection(state: PostsState, hasInvestments: Boolean) {
    val scope = rememberCoroutineScope()
    when (val phase = state.piecesPhase) {
        PostsPhase.Off -> Unit
        PostsPhase.Idle, PostsPhase.Loading -> Titled("From the website") { RowsCard { MarketingReading("Reading the website…") } }
        is PostsPhase.Failed -> Titled("From the website") {
            RowsCard {
                Text(phase.message, Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
                androidx.compose.material3.OutlinedButton(onClick = { scope.launch { PostsStore.load(gold = hasInvestments) } }, modifier = Modifier.padding(16.dp)) { Text("Try again") }
            }
        }
        PostsPhase.Loaded -> {
            val fresh = state.pieces.filter { it.newArrival }
            val strip = (if (fresh.isEmpty()) state.pieces else fresh).take(12)
            Titled(if (fresh.isEmpty()) "From ${state.siteName}" else "New on ${state.siteName}") {
                RowsCard {
                    if (strip.isNotEmpty()) {
                        val navigator = LocalNavigator.current
                        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(strip, key = { it.id }) { p ->
                                Box(Modifier.width(112.dp).zoomSource(MarketingKit.piecePath(p.id), Radius.tile).clickable(role = Role.Button) { navigator.open(MarketingKit.piecePath(p.id)) }) { PostPieceTile(p, state.posted[p.id]) }
                            }
                        }
                    }
                    MarketingLink("All ${state.pieces.size} pieces", Icons.Filled.GridView, MarketingKit.piecesPath)
                }
            }
        }
    }
}

/** A website piece as a tile: its photo, its name, and when it last went out (or its collection). */
@Composable
fun PostPieceTile(piece: PostPiece, posted: String?, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(Radius.tileShape)) {
            StockImage(piece.thumb, piece.name, piece.id, Modifier.fillMaxSize())
            if (piece.newArrival) {
                Text(
                    "New",
                    Modifier.padding(6.dp).clip(CircleShape).background(ErpColors.accent).padding(horizontal = 6.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold), color = ErpColors.onAccent,
                )
            }
        }
        Text(piece.name, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold), maxLines = 2, overflow = TextOverflow.Ellipsis)
        // Amber when it went out today, the web's cue not to send it again.
        val days = MarketingTime.daysAgo(posted)
        val tone: Color = if (days != null && days < 1) Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant
        Text(MarketingTime.postedAgo(posted) ?: piece.collection, style = MaterialTheme.typography.labelSmall, color = tone, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
