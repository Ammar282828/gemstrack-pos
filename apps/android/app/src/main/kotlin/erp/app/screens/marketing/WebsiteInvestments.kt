package erp.app.screens.marketing

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.device.openAddress
import erp.app.device.shareText
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.ActionRow
import erp.app.ui.AppClock
import erp.app.ui.FailureAlert
import erp.app.ui.FormSection
import erp.app.ui.FullScreenSheet
import erp.app.ui.LedgerSection
import erp.app.ui.NotAvailableState
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.ToggleRow
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerCard
import erp.app.ui.ledgerRow
import erp.app.ui.readableColumn
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The fortnight's posts, the schedule and today's plan, read together for the screen and a day's sheet. */
data class WebsiteGoldState(
    val phase: PostsPhase = PostsPhase.Idle,
    val posts: List<WebsiteGoldPost> = emptyList(),
    val today: String = "",
    val schedule: WebsiteGoldSchedule? = null,
    val status: WebsiteGoldStatus? = null,
) {
    /** The parts this shop can send, in the order they go, in the ERP's words. */
    val targets: List<WebsiteGoldStatus.Target> get() = status?.targets ?: emptyList()
    val todays: WebsiteGoldPost? get() = posts.firstOrNull { it.date == today }
    fun post(id: String): WebsiteGoldPost? = posts.firstOrNull { it.id == id }
}

object WebsiteGold {
    private val _state = MutableStateFlow(WebsiteGoldState())
    val state: StateFlow<WebsiteGoldState> = _state.asStateFlow()

    @Volatile private var loading = false

    suspend fun load() {
        if (House.isDemo) {
            val (a, s, st) = WebsiteDemo.gold(AppClock.now())
            _state.value = WebsiteGoldState(PostsPhase.Loaded, a.posts, a.today, s, st)
            return
        }
        if (loading) return
        loading = true
        try {
            if (_state.value.phase != PostsPhase.Loaded) _state.update { it.copy(phase = PostsPhase.Loading) }
            val (answer, plan, now) = coroutineScope {
                val a = async { WebsiteApi.get("/api/investments", WebsiteGoldAnswer) }
                val s = async { WebsiteApi.get("/api/investments/schedule", WebsiteGoldScheduleAnswer) }
                val st = async { WebsiteApi.get("/api/investments/status", WebsiteGoldStatus) }
                Triple(a.await(), s.await(), st.await())
            }
            _state.value = WebsiteGoldState(PostsPhase.Loaded, answer.posts, answer.today, plan.schedule, now)
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 404) _state.update { it.copy(phase = PostsPhase.Off) }
            else if (_state.value.phase != PostsPhase.Loaded) _state.update { it.copy(phase = PostsPhase.Failed(e.message)) }
        } catch (e: Exception) {
            if (_state.value.phase != PostsPhase.Loaded) _state.update { it.copy(phase = PostsPhase.Failed(e.message ?: "Something went wrong.")) }
        } finally {
            loading = false
        }
    }

    /**
     * One part through the Send route. True when it went, or had already gone (the schedule got there first): that part is
     * done, not an error. Edited words go with it and are saved.
     */
    suspend fun send(id: String, target: String, force: Boolean, post: String?, teaser: String?): Boolean {
        val body = LinkedHashMap<String, Any?>().apply { put("target", target); put("force", force); if (post != null) put("post", post); if (teaser != null) put("teaser", teaser) }
        return try {
            ErpApi.shared.send("/api/investments/$id/publish", body = body, timeoutMs = 130_000)
            true
        } catch (e: ErpApi.Failure) {
            if (e.status == 409 && !force) true else throw e
        }
    }

    /** Hold the day, let it go, approve it, or clear a part that failed three times. */
    suspend fun plan(id: String, change: Map<String, Any?>) {
        ErpApi.shared.send("/api/investments/$id/plan", body = change)
        load()
    }

    suspend fun saveSchedule(s: WebsiteGoldSchedule) {
        ErpApi.shared.send("/api/investments/schedule", "PUT", mapOf("schedule" to s.body))
        load()
    }

    /** A day filed by hand (the routine's four things); nothing is sent on filing. */
    suspend fun file(date: String, post: String, teaser: String, square: ByteArray?, story: ByteArray?) {
        val files = buildList {
            if (square != null) add(ErpApi.FormFile("square", "square.jpg", "image/jpeg", square))
            if (story != null) add(ErpApi.FormFile("story", "story.jpg", "image/jpeg", story))
        }
        ErpApi.shared.upload("/api/investments", listOf("date" to date, "post" to post, "teaser" to teaser), files, timeoutMs = 90_000)
        load()
    }

    /** A day's card, served by the ERP to anyone (Instagram fetches the story from there too). */
    fun cardUrl(p: WebsiteGoldPost, kind: String): String =
        "${House.serverUrl.trimEnd('/')}/api/public/investments/${p.id}/$kind?v=${MarketingKit.escape(p.receivedAt)}"
}

/**
 * Website → Investments (src/app/website/investments/page.tsx): Taheri's daily gold post, filed each morning by the owner's
 * Claude routine. The fortnight, newest first; a day opens to change its words and send each part where it goes (the post and
 * its square card to the Investments group and the channel, the teaser to the community's announcements, the story card to
 * Instagram), or all of them in order. Automatic sending is the owner's schedule; today's card says what it will do with each
 * part (the server's own words, /api/investments/status) and can hold the day, give it the OK, or try a failed part again.
 *
 * Every route is the web page's own. Anything that reaches people (a send, switching the schedule on, an OK, a held day let
 * go, a retry) first lists exactly what goes where; a part goes once, and sending it again asks.
 */
@Composable
fun WebsiteInvestmentsScreen() {
    ScreenTitle("Investments")
    val gold by WebsiteGold.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var opened by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var confirmingOn by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { WebsiteGold.load() }
    // While the schedule is on, what it sends shows up here without a pull.
    val scheduleOn = gold.schedule?.enabled ?: false
    LaunchedEffect(scheduleOn) {
        if (!scheduleOn) return@LaunchedEffect
        while (true) {
            delay(60_000)
            WebsiteGold.load()
        }
    }
    ScreenActions {
        IconButton(onClick = { adding = true }, enabled = gold.phase == PostsPhase.Loaded) { Icon(Symbols.Add, "Add by hand") }
    }

    fun flip(on: Boolean) {
        val s = gold.schedule ?: return
        if (!on) {
            scope.launch {
                busy = "Switching it off…"
                try { WebsiteGold.saveSchedule(s.copy(enabled = false)) } catch (e: CancellationException) { throw e } catch (e: Exception) { failure = e.message ?: "Something went wrong." } finally { busy = null }
            }
            return
        }
        val going = gold.targets.filter { s.plan(it.id).on }
        if (going.isEmpty() || s.days.isEmpty()) {
            failure = "Choose what goes first: switch on at least one part in the schedule, and pick its days. Then switch it on."
            editing = true
            return
        }
        confirmingOn = true
    }

    Box(Modifier.fillMaxSize()) {
        when (val phase = gold.phase) {
            PostsPhase.Off -> NotAvailableState("Investments by Taheri isn't part of this shop", why = "Its daily post belongs to Taheri's own website.", icon = Symbols.ShowChart)
            is PostsPhase.Failed -> MarketingErrorState(phase.message) { scope.launch { WebsiteGold.load() } }
            PostsPhase.Idle, PostsPhase.Loading -> SkeletonLoading(Modifier.fillMaxSize())
            PostsPhase.Loaded -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; WebsiteGold.load(); refreshing = false } }) {
                Box(Modifier.fillMaxSize()) {
                    Column(
                        Modifier.fillMaxSize().readableColumn(720.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(20.dp),
                    ) {
                        GoldPage(gold, ::flip, { editing = true }) { opened = it }
                    }
                }
            }
        }
        WebsiteBusy(busy)
    }

    opened?.let { WebsiteGoldDaySheet(it, onClose = { opened = null }) }
    if (editing) WebsiteGoldScheduleSheet(onClose = { editing = false })
    if (adding) WebsiteGoldAddSheet(onClose = { adding = false })
    if (confirmingOn) {
        val s = gold.schedule
        WebsiteConfirm(
            "Send Investments by Taheri automatically?", if (s != null) WebsiteGoldWords.switchOn(s, gold.targets) else "",
            listOf(WebsiteChoice("Switch it on") {
                val sch = gold.schedule ?: return@WebsiteChoice
                scope.launch {
                    busy = "Switching it on…"
                    try { WebsiteGold.saveSchedule(sch.copy(enabled = true)) } catch (e: CancellationException) { throw e } catch (e: Exception) { failure = e.message ?: "Something went wrong." } finally { busy = null }
                }
            }),
            onDismiss = { confirmingOn = false },
        )
    }
    FailureAlert(failure, { failure = null })
}

@Composable
private fun GoldPage(gold: WebsiteGoldState, flip: (Boolean) -> Unit, edit: () -> Unit, open: (String) -> Unit) {
    ScheduleSection(gold, flip, edit)
    if (gold.todays == null) {
        Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(Symbols.Schedule, null, tint = Tone.owed.color())
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Today's post hasn't arrived yet.")
                Text(
                    "The routine runs at 11:00 and files it here when it finishes${if (gold.schedule?.enabled == true) "; the schedule sends it once it's here" else ""}. If it ran and nothing came, check its last step on claude.ai, or add today's by hand.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    FormSection("The fortnight") {
        if (gold.posts.isEmpty()) {
            Text("No posts yet. The first arrives with the routine's next run.", Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (p in gold.posts) DayRow(p, gold) { open(p.id) }
    }
}

@Composable
private fun DayRow(p: WebsiteGoldPost, gold: WebsiteGoldState, open: () -> Unit) {
    val targets = gold.targets
    val sent = targets.count { p.sent[it.id] != null }
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = open).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(WebsiteGoldTime.longDate(p.date), style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.SemiBold))
                if (p.hold) Pill("Held", tone = Tone.quiet)
            }
            Text(p.headline, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        Text("$sent/${targets.size} sent", style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Icon(Symbols.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f))
    }
}

@Composable
private fun ScheduleSection(gold: WebsiteGoldState, flip: (Boolean) -> Unit, edit: () -> Unit) {
    val s = gold.schedule
    FormSection("Automatic sending", footer = if (s != null) ({ Text(WebsiteGoldWords.checked(s)) }) else null) {
        if (s != null) {
            ToggleRow(
                "Automatic sending", s.enabled, flip,
                sub = if (s.enabled) WebsiteGoldWords.summary(s, gold.targets) else "Off: nothing goes out unless someone presses Send.",
            )
            if (WebsiteGoldWords.silent(s)) {
                Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                    Icon(Symbols.Warning, null, tint = Tone.owed.color())
                    Text(
                        if (s.lastTick == null) "The scheduler hasn't checked in yet. It runs every 5 minutes; if this stays, nothing goes out by itself."
                        else "The scheduler last checked in ${WebsiteGoldTime.ago(s.lastTick)}. It should every 5 minutes: until it does, nothing goes out by itself.",
                        style = MaterialTheme.typography.bodyMedium, color = Tone.owed.color(),
                    )
                }
            }
            ActionRow("Edit the schedule", edit, Symbols.CalendarMonth)
        } else {
            Text("The schedule couldn't be read.", Modifier.fillMaxWidth().padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// MARK: A day

/**
 * One day's post (page.tsx `DayCard`): its words, changeable before they go; its cards; each part and where it goes, sent
 * once; Send all; and today's say over the schedule.
 */
@Composable
fun WebsiteGoldDaySheet(id: String, onClose: () -> Unit) {
    val gold by WebsiteGold.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val day = gold.post(id)
    var post by remember { mutableStateOf("") }
    var teaser by remember { mutableStateOf("") }
    var filled by remember { mutableStateOf(false) }
    var ask by remember { mutableStateOf<WebsiteGoldAsk?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var said by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    if (!filled && day != null) { post = day.post; teaser = day.teaser; filled = true }
    val isToday = day?.date == gold.today
    val scheduled = isToday && (gold.schedule?.enabled ?: false)

    suspend fun plan(change: Map<String, Any?>, words: String) {
        val d = day ?: return
        busy = "Changing the plan…"
        said = null
        try {
            WebsiteGold.plan(d.id, change)
            said = words
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = e.message ?: "Something went wrong."
        } finally {
            busy = null
        }
    }

    /** One part after another, the group first: if one fails the rest still go, and each says how it went. */
    suspend fun send(list: List<String>, force: Boolean) {
        val d = day ?: return
        busy = if (list.size > 1) "Sending all…" else "Sending…"
        said = null
        val done = ArrayList<String>()
        val problems = ArrayList<String>()
        try {
            for (t in list) {
                busy = "Sending " + WebsiteGoldWords.place(t, gold.targets) + "…"
                try {
                    if (WebsiteGold.send(d.id, t, force, if (post != d.post) post else null, if (teaser != d.teaser) teaser else null)) done.add(t)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    problems.add(WebsiteGoldWords.place(t, gold.targets) + ": " + (e.message ?: "Failed"))
                }
            }
            WebsiteGold.load()
            WebsiteGold.state.value.post(d.id)?.let { fresh ->
                // The words that went are the saved ones now.
                post = fresh.post
                teaser = fresh.teaser
            }
            if (done.isNotEmpty()) {
                said = (if (done.size == list.size) (if (list.size > 1) "All sent: " else "Sent: ") else "${done.size} of ${list.size} sent: ") +
                    done.joinToString(" · ") { WebsiteGoldWords.place(it, gold.targets) }
            }
            if (problems.isNotEmpty()) failure = problems.joinToString("\n")
        } finally {
            busy = null
        }
    }

    val haptics = erp.app.ui.rememberHaptics()
    LaunchedEffect(said) { if (said != null) haptics.success() }
    val unsent = if (day == null) emptyList() else gold.targets.filter { day.sent[it.id] == null && !WebsiteGoldWords.missing(it.id, day, post, teaser) }.map { it.id }
    FullScreenSheet(
        title = day?.let { WebsiteGoldTime.longDate(it.date) } ?: "Investments", onCancel = { if (busy == null) onClose() }, cancelText = "Done",
        confirmText = "Done", onConfirm = { if (busy == null) onClose() },
    ) {
        MarketingPinned(bar = if (unsent.size > 1) ({
            MarketingActionBar(
                "Send all ${WebsiteGoldWords.count(unsent.size)}", Symbols.Send, { ask = WebsiteGoldAsk.Send(unsent, false) }, busy = busy != null,
                summary = "Each part goes once. None of it can be unsent from here.",
            )
        }) else null) { Box(Modifier.fillMaxSize()) {
            if (day == null) {
                NotAvailableState("This day's post is gone", icon = Symbols.Inbox)
            } else {
                PullToRefreshBox(isRefreshing = false, onRefresh = { scope.launch { WebsiteGold.load() } }) {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        DayPage(day, gold, isToday, scheduled, post, teaser, { post = it }, { teaser = it }, said, context, { ask = it }) { scope.launch { plan(mapOf("hold" to true), "Held: today won't go by itself.") } }
                    }
                }
            }
            WebsiteBusy(busy)
        } }
    }
    ask?.let { a ->
        WebsiteConfirm(
            WebsiteGoldAsk.title(a), WebsiteGoldAsk.words(a, day, gold.schedule, gold.targets),
            listOf(WebsiteChoice(WebsiteGoldAsk.button(a)) {
                scope.launch {
                    when (a) {
                        is WebsiteGoldAsk.Send -> send(a.list, a.force)
                        WebsiteGoldAsk.Approve -> plan(mapOf("approve" to true), "Approved: it goes at its times.")
                        WebsiteGoldAsk.LetGo -> plan(mapOf("hold" to false), "It sends by itself again.")
                        is WebsiteGoldAsk.Retry -> plan(mapOf("retry" to a.target), "The next check tries it again.")
                    }
                }
            }),
            onDismiss = { ask = null },
        )
    }
    FailureAlert(failure, { failure = null }, title = "Not all of it went")
}

@Composable
private fun DayPage(
    d: WebsiteGoldPost, gold: WebsiteGoldState, isToday: Boolean, scheduled: Boolean, post: String, teaser: String,
    setPost: (String) -> Unit, setTeaser: (String) -> Unit, said: String?, context: android.content.Context,
    ask: (WebsiteGoldAsk) -> Unit, hold: () -> Unit,
) {
    val edited = post != d.post || teaser != d.teaser
    if (said != null) {
        Row(Modifier.fillMaxWidth().ledgerCard(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Symbols.CheckCircle, null, tint = Tone.settled.color())
            Text(said, color = Tone.settled.color())
        }
    }
    FormSection("Post · ${post.length} characters", footer = if (post.length > 1024) ({ Text("Too long for a caption: it goes under the card.") }) else null) {
        Mono(post, setPost, "The WhatsApp post", 6, 24)
        ActionRow("Share or copy the post", { shareText(context, "Investments", post) }, Symbols.Share)
    }
    FormSection(
        "Teaser · for the main community",
        footer = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (edited) {
                    Text(
                        "You've changed the words: what you send now is your version, and it's saved when it goes.${if (scheduled) " The schedule sends the saved words, so send by hand to use these." else ""}",
                        color = Tone.owed.color(),
                    )
                }
                Text(arrivedWords(d))
            }
        },
    ) {
        Mono(teaser, setTeaser, "The teaser (optional)", 3, 14)
        if (teaser.isNotEmpty()) ActionRow("Share or copy the teaser", { shareText(context, "Investments", teaser) }, Symbols.Share)
    }
    CardsSection(d, context)
    if (scheduled) PlanSection(d, gold, ask, hold)
    SendSection(d, gold, isToday, scheduled, post, teaser, ask)
}

@Composable
private fun Mono(value: String, onChange: (String) -> Unit, placeholder: String, min: Int, max: Int) {
    OutlinedTextField(
        value = value, onValueChange = onChange, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        placeholder = { Text(placeholder) }, minLines = min, maxLines = max,
        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 13.sp),
    )
}

/** "Arrived Today 11:20 am from the Claude routine · edited Today 11:40 am". */
private fun arrivedWords(d: WebsiteGoldPost): String {
    var s = "Arrived " + ShopDate.say(d.receivedAt, withTime = true) + " from " + (if (d.source == "routine") "the Claude routine" else "the ERP")
    d.editedAt?.let { s += " · edited " + ShopDate.say(it, withTime = true) }
    return s
}

@Composable
private fun CardsSection(d: WebsiteGoldPost, context: android.content.Context) {
    LedgerSection("Cards") {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.weight(1f)) { CardTile(d, "square", "Square", context) }
            Box(Modifier.weight(1f)) { CardTile(d, "story", "Story", context) }
        }
    }
}

@Composable
private fun CardTile(d: WebsiteGoldPost, kind: String, label: String, context: android.content.Context) {
    if (kind in d.cards) {
        val url = WebsiteGold.cardUrl(d, kind)
        Column(Modifier.fillMaxWidth().clickable(role = Role.Button) { openAddress(context, android.content.Intent.ACTION_VIEW, url) }, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            StockImage(url, label, d.id + kind + d.receivedAt, Modifier.fillMaxWidth().heightIn(max = 260.dp).aspectRatio(if (kind == "square") 1f else 9f / 16f, matchHeightConstraintsFirst = false).clip(Radius.thumbShape))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Symbols.OpenInNew, null, Modifier.padding(0.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    } else {
        Box(Modifier.fillMaxWidth().heightIn(min = 90.dp).ledgerCard(8.dp), contentAlignment = Alignment.Center) {
            Text("No $kind card", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PlanSection(d: WebsiteGoldPost, gold: WebsiteGoldState, ask: (WebsiteGoldAsk) -> Unit, hold: () -> Unit) {
    FormSection("On the schedule") {
        if (gold.schedule?.mode == "approve") {
            val at = d.approvedAt
            if (at != null) {
                Text("Approved ${ShopDate.say(at, withTime = true)}", Modifier.fillMaxWidth().ledgerRow(), color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (!d.hold) {
                ActionRow("Approve today", { ask(WebsiteGoldAsk.Approve) }, Symbols.Verified)
            }
        }
        if (d.hold) ActionRow("Let it send", { ask(WebsiteGoldAsk.LetGo) }, Symbols.PlayArrow)
        else ActionRow("Hold today", hold, Symbols.Pause)
    }
}

@Composable
private fun SendSection(d: WebsiteGoldPost, gold: WebsiteGoldState, isToday: Boolean, scheduled: Boolean, post: String, teaser: String, ask: (WebsiteGoldAsk) -> Unit) {
    val targets = gold.targets
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FormSection("Where it goes", footer = { Text("Each part goes once. None of it can be unsent from here.") }) {
            for (t in targets) PartRow(t, d, gold, isToday, scheduled, post, teaser, ask)
        }
    }
}

@Composable
private fun PartRow(
    t: WebsiteGoldStatus.Target, d: WebsiteGoldPost, gold: WebsiteGoldState, isToday: Boolean, scheduled: Boolean, post: String, teaser: String,
    ask: (WebsiteGoldAsk) -> Unit,
) {
    val went = d.sent[t.id]
    val part = if (isToday) gold.status?.parts?.get(t.id) else null
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(t.label, style = MaterialTheme.typography.bodyLarge.copy(fontWeight = FontWeight.Medium))
                Text("to " + t.to, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (went != null) {
                // Gone is the expected state: the time, quietly.
                Text(ShopDate.say(went.at, withTime = true) + if (went.by == "schedule") " · auto" else "", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        val line = part?.line
        if (scheduled && line != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.Top) {
                Icon(Symbols.Schedule, null, Modifier.padding(0.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    line, style = MaterialTheme.typography.bodySmall,
                    // A plan on time is the expected state: only a warning is coloured.
                    color = if (part.tone == "warn") Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { ask(WebsiteGoldAsk.Send(listOf(t.id), went != null)) }, enabled = !WebsiteGoldWords.missing(t.id, d, post, teaser)) {
                Text(if (went == null) "Send now" else "Send again…")
            }
            if (scheduled && part?.kind == "gave-up") TextButton(onClick = { ask(WebsiteGoldAsk.Retry(t.id)) }) { Text("Try again") }
        }
    }
}
