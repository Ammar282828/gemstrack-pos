package erp.app.screens.marketing

import erp.app.config.House
import erp.app.data.ErpApi
import erp.app.ui.AppClock
import java.net.URI
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The house does not post its website's pieces (404 from the route): nothing to show, nothing wrong. */
sealed interface PostsPhase {
    data object Idle : PostsPhase
    data object Loading : PostsPhase
    data object Loaded : PostsPhase
    data class Failed(val message: String) : PostsPhase
    data object Off : PostsPhase
}

/** What the Posts hub and its pieces screens read, and the small questions they ask of it (PostsStore's computed properties). */
data class PostsState(
    val piecesPhase: PostsPhase = PostsPhase.Idle,
    val pieces: List<PostPiece> = emptyList(),
    val site: String = "",
    val posted: Map<String, String> = emptyMap(),
    /** null until the first answer; an empty list is "nothing in the last two days". */
    val sent: List<PostSent>? = null,
    val queue: List<PostQueueEntry> = emptyList(),
    val checks: List<PostCheck> = emptyList(),
    val gold: PostGold? = null,
    val goldParts: List<String> = emptyList(),
    val audience: PostAudience = PostAudience(),
    val sentError: String? = null,
) {
    fun piece(id: String): PostPiece? = pieces.firstOrNull { it.id == id }

    /** What went out today (Karachi's day), newest first as the server sends it. */
    fun sentToday(now: Instant = AppClock.now()): List<PostSent> = (sent ?: emptyList()).filter { MarketingTime.isToday(it.at, now) }

    /** The latest send of an earlier day, for "the last was …" on a quiet day. */
    fun lastEarlier(now: Instant = AppClock.now()): PostSent? = (sent ?: emptyList()).firstOrNull { !MarketingTime.isToday(it.at, now) }

    /**
     * The queue as the web hub shows it: what is still to go, and what went today. Failed first, then what is going,
     * then by the time it is due, then what is held.
     */
    fun queueShown(now: Instant = AppClock.now()): List<PostQueueEntry> {
        val shown = queue.filter { it.status != "sent" || MarketingTime.isToday(it.sentAt ?: it.createdAt, now) }
        fun rank(e: PostQueueEntry) = when (e.status) {
            "failed" -> 0; "sending" -> 1; "scheduled" -> 2; "held" -> 3; "draft" -> 4; else -> 5
        }
        return shown.sortedWith(compareBy<PostQueueEntry>({ rank(it) }, { it.dueAt ?: it.createdAt }))
    }

    val failingChecks: List<PostCheck> get() = checks.filter { it.status == "fail" }

    /** What Send all and Spread over the day act on (queue-panel.tsx `pending`): held, scheduled or failed, in the queue's order. */
    val waiting: List<PostQueueEntry> get() = queue.filter { it.status in listOf("held", "scheduled", "failed") }

    /** A send log's name for a place, in the counter's words (page.tsx `placeName`). */
    fun placeName(log: String): String = when {
        log == "whatsapp-community" -> audience.groups.firstOrNull { it.name == audience.communityName }?.label ?: "Announcements"
        log == "whatsapp-channel" -> "Channel"
        log == "instagram-story" -> "Instagram story"
        log == "instagram-post" -> "Instagram post"
        log.startsWith("whatsapp-group:") -> {
            val key = log.removePrefix("whatsapp-group:")
            audience.groups.firstOrNull { it.key == key }?.label ?: key
        }
        else -> log
    }

    /** A WhatsApp destination's name, as the counter knows it. */
    fun placeLabel(key: String): String = if (key == "channel") "Channel" else audience.groups.firstOrNull { it.key == key }?.label ?: key

    /** A queued piece's places in words: "Website, Instagram story, Announcements, Channel". */
    fun queueWhere(e: PostQueueEntry): String {
        val places = ArrayList<String>()
        if (e.toWebsite) places.add("Website")
        if (e.toInstagram) places.add("Instagram story")
        if ("ig-post" in e.unitKeys) places.add("Instagram post")
        for (key in e.whatsapp) places.add(placeLabel(key))
        return places.joinToString(", ")
    }

    val siteName: String
        get() {
            val host = try { URI(site).host } catch (e: Exception) { null } ?: return "the website"
            return host.removePrefix("www.")
        }
}

/**
 * What the Posts hub and its pieces screens read: the day's sends, the queue, the website's pieces, Taheri's gold post
 * and the posting lines' checks. One copy for the whole app, so the pieces screen opens on what the hub already fetched.
 * Every route here is the web hub's own (src/app/posts/page.tsx), gated by the same `postGate`: owners, staff and
 * marketing accounts.
 */
object PostsStore {
    private val _state = MutableStateFlow(PostsState())
    val state: StateFlow<PostsState> = _state.asStateFlow()

    @Volatile private var loading = false
    private var checksAt: Instant? = null
    private var audienceAt: Instant? = null

    val goldOrder = listOf("group", "channel", "teaser", "instagram")
    val goldWords = mapOf("group" to "Group", "channel" to "Channel", "teaser" to "Teaser", "instagram" to "Story")

    /**
     * Everything the hub shows. The checks and the audience's names ask WhatsApp and Meta, which can take a while, so
     * they arrive on their own and never hold the pull-to-refresh.
     */
    suspend fun load(gold: Boolean = false) {
        if (loading) return
        loading = true
        try {
            if (House.isDemo) { _state.value = PostsDemo.state(AppClock.now()); return }
            if (_state.value.piecesPhase == PostsPhase.Idle) _state.update { it.copy(piecesPhase = PostsPhase.Loading) }
            coroutineScope {
                launch { loadAudience() }
                launch { loadChecks() }
                val reads = listOf(async { loadPieces() }, async { loadSent() }, async { loadQueue() }, async { loadGold(gold) })
                reads.forEach { it.await() }
            }
        } finally {
            loading = false
        }
    }

    // MARK: Reads

    private suspend fun loadPieces() {
        try {
            val a = PostPiecesAnswer.from(ErpApi.shared.get("/api/website/site-pieces?lean=1")) ?: PostPiecesAnswer("", emptyList(), emptyMap())
            _state.update { it.copy(site = a.site, pieces = a.pieces.filter { p -> !p.hidden }, posted = a.posted, piecesPhase = PostsPhase.Loaded) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ErpApi.Failure) {
            if (e.status == 404) _state.update { it.copy(piecesPhase = PostsPhase.Off) }
            else if (_state.value.pieces.isEmpty()) _state.update { it.copy(piecesPhase = PostsPhase.Failed(e.message)) }
        } catch (e: Exception) {
            if (_state.value.pieces.isEmpty()) _state.update { it.copy(piecesPhase = PostsPhase.Failed(e.message ?: "Couldn't read the website.")) }
        }
    }

    private suspend fun loadSent() {
        try {
            val a = PostSentAnswer.from(ErpApi.shared.get("/api/website/post/recent"))
            _state.update { it.copy(sent = a?.sent ?: emptyList(), sentError = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_state.value.sent == null) _state.update { it.copy(sentError = e.message) }
        }
    }

    private suspend fun loadQueue() {
        try {
            PostQueueAnswer.from(ErpApi.shared.get("/api/website/post/queue"))?.let { a -> _state.update { it.copy(queue = a.items) } }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
        }
    }

    /**
     * The checks reach out to WhatsApp, Instagram, the site and the AI (up to a minute); the web page runs them when it
     * opens, here they are asked again after ten minutes.
     */
    private suspend fun loadChecks() {
        val at = checksAt
        if (at != null && ChronoUnit.SECONDS.between(at, Instant.now()) < 600) return
        try {
            PostChecksAnswer.from(ErpApi.shared.get("/api/website/post/health"))?.let { a ->
                _state.update { it.copy(checks = a.checks) }
                checksAt = Instant.now()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
        }
    }

    /** The groups' names change rarely; once an hour is plenty. */
    private suspend fun loadAudience() {
        val at = audienceAt
        if (at != null && ChronoUnit.SECONDS.between(at, Instant.now()) < 3600) return
        try {
            PostAudience.from(ErpApi.shared.get("/api/website/post"))?.let { a ->
                _state.update { it.copy(audience = a) }
                audienceAt = Instant.now()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
        }
    }

    /**
     * Today's gold post and which of its parts this shop sends (the routine files it; the page and the schedule send
     * it). Where the shop has no Investments the hub never asks.
     */
    private suspend fun loadGold(wanted: Boolean) {
        if (!wanted) return
        val a = try { PostGoldAnswer.from(ErpApi.shared.get("/api/investments")) } catch (e: CancellationException) { throw e } catch (e: Exception) { null } ?: return
        val parts = try { PostGoldParts.from(ErpApi.shared.get("/api/investments/schedule")) } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
        // The channel only where WhatsApp's channel is set up (lib/investments-schedule.ts: dest ? dest[t] : t !== 'channel').
        val shown = goldOrder.filter { t -> parts?.destinations?.get(t) ?: (t != "channel") }
        _state.update { it.copy(gold = a.posts.firstOrNull { p -> p.date == a.today }, goldParts = shown) }
    }

    // MARK: The queue's actions (the web hub's own routes; the sending itself is the server's, once)

    suspend fun refreshQueue() {
        // The demo has no server: its queue is the made-up one, read once.
        if (House.isDemo) { if (_state.value.queue.isEmpty()) _state.value = PostsDemo.state(AppClock.now()); return }
        loadQueue()
    }

    /** The tray asks again on opening: a group added or renamed since shows at once. */
    suspend fun refreshAudience() {
        if (House.isDemo) return
        audienceAt = null
        loadAudience()
    }

    /** After the tray sends: the day's list, and the pieces' "posted" and the weights the site now keeps. */
    suspend fun afterSending() {
        if (House.isDemo) return
        coroutineScope {
            launch { loadSent() }
            launch { loadPieces() }
        }
    }

    /**
     * Spread over the day: each waiting piece its own time (PATCH /queue/:id), the times laid out by `spreadTimes`. The tick on
     * the server sends them, with every screen closed. Stops at the first the server refuses.
     */
    suspend fun spread(ids: List<String>, times: List<Instant>) {
        try {
            for ((id, at) in ids.zip(times)) {
                ErpApi.shared.send("/api/website/post/queue/$id", "PATCH", mapOf("action" to "schedule", "dueAt" to isoSeconds(at)))
            }
        } catch (e: Exception) {
            loadQueue()
            throw e
        }
        loadQueue()
    }

    /** Send all now: each waiting piece in turn, as Send now sends one. How many went whole, of how many. */
    suspend fun sendAll(): Pair<Int, Int> {
        val ids = _state.value.waiting.map { it.id }
        var sent = 0
        for (id in ids) {
            val whole = try { sendNow(id) } catch (e: CancellationException) { throw e } catch (e: Exception) { false }
            if (whole) sent++
        }
        return sent to ids.size
    }

    /**
     * "Send now" (POST /queue/:id/send). Only what has not gone is sent, so a second press after a failure never posts a
     * group twice. The server may take minutes over many groups. True when everything went.
     */
    suspend fun sendNow(id: String): Boolean {
        val out = ErpApi.shared.send("/api/website/post/queue/$id/send", "POST", emptyMap(), 310_000)
        loadQueue()
        return (out["ok"] as? Boolean) ?: false
    }

    /** Hold it (PATCH /queue/:id). */
    suspend fun hold(id: String) {
        ErpApi.shared.send("/api/website/post/queue/$id", "PATCH", mapOf("action" to "hold"))
        loadQueue()
    }

    suspend fun schedule(id: String, at: Instant) {
        ErpApi.shared.send("/api/website/post/queue/$id", "PATCH", mapOf("action" to "schedule", "dueAt" to isoSeconds(at)))
        loadQueue()
    }

    /** Out of the queue, with its photos (DELETE /queue/:id). Nothing that already went is taken back. */
    suspend fun remove(id: String) {
        ErpApi.shared.send("/api/website/post/queue/$id", "DELETE")
        loadQueue()
    }

    /** `Date.ISO8601Format()`: whole seconds, Z. */
    fun isoSeconds(at: Instant): String = DateTimeFormatter.ISO_INSTANT.format(at.truncatedTo(ChronoUnit.SECONDS))
}
