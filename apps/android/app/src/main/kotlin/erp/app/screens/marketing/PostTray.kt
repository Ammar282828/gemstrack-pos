package erp.app.screens.marketing

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.ui.Note
import erp.core.logic.postOnlyWeight
import erp.core.logic.validWeight
import erp.core.logic.weightForSite
import kotlin.coroutines.cancellation.CancellationException
import kotlin.random.Random
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// The Posts tray (src/app/posts/page.tsx and ./piece-card.tsx), natively (PostTray.swift): website pieces picked one or a few
// at a time, each a card of its own with its weight, its caption and its story, and one Send that takes them all to the same
// groups and the channel, one after another, after one confirm, or Later, into the queue. The sending is the server's
// (POST /api/website/post, the queue's routes); the caption and the stamped photo are the web's own code, run by the bundled
// engine (design-engine.ts `siteCaption`, `stamp`, `siteStory`), so the phone sends what the web does.

/** The tray's words and small rules (pure, so they are tested). */
object PostTrayLogic {
    /** Enough for one sitting; more is the queue's to spread (page.tsx MAX_PICK). */
    const val MAX_PICK = 10

    /** Pieces posted within this many days are skipped by Shuffle (page.tsx FRESH_DAYS). */
    const val FRESH_DAYS = 30

    fun noun(n: Int): String = if (n == 1) "piece" else "pieces"

    /** The weight as the caption takes it: Number(typed), as the web's card passes it. */
    fun typedGrams(typed: String): Double = typed.trim().toDoubleOrNull() ?: 0.0

    /** "a", "a and b", "a, b and c" (queue-panel.tsx listOf). */
    fun listOf(xs: List<String>): String = if (xs.size > 1) xs.dropLast(1).joinToString(", ") + " and " + xs.last() else xs.firstOrNull() ?: ""

    /** The file's name, from the piece's own address (piece-card.tsx slugOf). */
    fun slug(p: PostPiece): String {
        val last = p.url.split('/').lastOrNull { it.isNotEmpty() } ?: ""
        val s = last.replace(Regex("[^\\w-]+"), "-").take(100)
        return s.ifEmpty { "piece" }
    }

    fun lowercasedFirst(s: String): String = s.take(1).lowercase() + s.drop(1)

    /** The tray's title. */
    fun title(count: Int): String = if (count > 1) "$count to send" else "Send a piece"

    /** The pick sheet's title. */
    fun pickTitle(count: Int): String = if (count == 0) "Pick pieces" else "$count picked"

    /** What the bar says under the buttons. */
    fun summary(count: Int, targets: List<String>, label: (String) -> String): String =
        if (targets.isEmpty()) "Choose where they go."
        else "To ${listOf(targets.map(label))}${if (count > 1) ", one after another" else ""}. Later puts ${if (count > 1) "them" else "it"} in the queue."

    fun confirmTitle(count: Int, targets: List<String>, label: (String) -> String): String =
        "Send ${if (count > 1) "these $count pieces" else "it"} to ${listOf(targets.map(label))}?"

    /** One piece in the confirmation: what of it goes, and when it last went out. */
    class Line(val name: String, val going: String, val posted: String?)

    /** Every piece and what of it goes, every place with how many it reaches, and what is failing now. */
    fun confirmWords(lines: List<Line>, places: List<String>, count: Int, failing: List<PostCheck>): String {
        val pieces = lines.map { "• ${it.name}: ${lowercasedFirst(it.going)}${it.posted?.let { p -> " · $p" } ?: ""}" }
        var out = pieces.joinToString("\n") + "\n\n" + places.joinToString("\n")
        out += "\n\nEach with its own caption and link${if (count > 1) ", one after another: it stops at the first that fails" else ""}. A post can't be unsent from here."
        if (failing.isNotEmpty()) out += "\n\nThis will probably fail:\n" + failing.joinToString("\n") { "${it.label}: ${it.fix ?: it.detail}" }
        return out
    }

    /** A place in the confirmation: its name and how many it reaches. */
    fun placeLine(key: String, name: String, channelName: String?, reach: Int?): String {
        val title = if (key == "channel") "${channelName ?: "Channel"} (channel)" else name
        val people = reach?.let { " — ${erp.core.logic.Money.grouped(it.toDouble())} ${if (key == "channel") "followers" else "members"}" } ?: ""
        return title + people
    }

    /** What the weight does here (piece-card.tsx's lines under the weight). */
    fun weightNote(
        designed: Boolean, designShowsWeight: Boolean, weightOnPhoto: Boolean, overlay: Boolean, weightOK: Boolean,
        newWeight: Double?, siteGrams: Double?, postOnly: Boolean, siteName: String,
    ): String {
        val lines = ArrayList<String>()
        if (designed) {
            lines.add(if (designShowsWeight) "Your design carries the weight. It also goes in the caption." else "Your design has no weight on it: pick a layout with the weight to add it. It goes in the caption.")
        } else if (weightOnPhoto) {
            lines.add(if (overlay) "This photo already shows its weight: with this on it shows twice." else "This photo already shows its weight.")
        } else if (overlay && !weightOK) {
            lines.add("Type the weight to put it on.")
        } else {
            lines.add("Top left, in the catalogue's own lettering. It also goes in the caption.")
        }
        if (newWeight != null) lines.add("$siteName has no weight for this piece: sending saves ${WebsiteNumber.grams(newWeight)}g to it too.")
        if (siteGrams != null && siteGrams > 0) {
            lines.add(if (postOnly) "For this post only: $siteName keeps ${WebsiteNumber.grams(siteGrams)}g." else "From $siteName: ${WebsiteNumber.grams(siteGrams)}g. Change it here for this post only.")
        }
        return lines.joinToString(" ")
    }

    /** piece-design.tsx's note beside the layouts. */
    fun designNote(house: String, p: PostPiece): String? {
        if (house == "mina" && p.photoSource != null) {
            return if (p.sourceMarked) "This photo carries the house's mark already: add nothing more."
            else "The photo from before the catalogue put the MINA mark on: the mark goes back top right, as on every catalogue photo."
        }
        return if (p.weightOnPhoto) "This photo already shows its weight and logo: a stamp would show them twice." else null
    }

    /** The first thing worth saying, with the rest after it (PostTrayScreen.say). */
    fun merge(notes: List<Note>): Note? {
        val first = notes.firstOrNull { it.failed } ?: notes.firstOrNull() ?: return null
        val rest = notes.filter { it != first }.map { it.title + if (it.detail.isEmpty()) "" else ": " + it.detail }
        val detail = (listOf(first.detail) + rest).filter { it.isNotEmpty() }.joinToString(" ")
        return Note(first.title, detail, first.failed)
    }
}

/** One piece in the tray: what the web's card keeps while the counter looks at another (PostTrayCard). */
class PostTrayCard(val piece: PostPiece) {
    val id: String get() = piece.id

    /** As typed; it starts as the site's, and a different one is this post's alone (site-weight.ts). */
    var weight by mutableStateOf(piece.weightGrams?.let { WebsiteNumber.grams(it) } ?: "")

    /** The weight stamped on the photo, on by default only where the photo doesn't show it. */
    var overlay by mutableStateOf((piece.weightGrams ?: 0.0) > 0 && !piece.weightOnPhoto)

    /** stampPhoto's colour: "auto", "white" or "dark". */
    var ink by mutableStateOf("auto")

    /** The AI's line and facts, in the house's frame in place of the site's own, while they are used. */
    var aiLine by mutableStateOf<String?>(null)
    var aiFacts by mutableStateOf<String?>(null)

    /** Typed over: a new weight then leaves the caption as it is. */
    var edited by mutableStateOf(false)
    var caption by mutableStateOf("")

    /** The photo that goes, when it isn't the website's own (the weight stamped on). */
    var preview by mutableStateOf<ImageBitmap?>(null)
    var sending by mutableStateOf(false)

    /** Why the last send of this piece failed. */
    var failed by mutableStateOf<String?>(null)
    var stamped: Pair<String, ByteArray>? = null

    /** Crop & design (piece-design.tsx): while there is one, it is the photo that goes, square, to the groups and the story. */
    var design by mutableStateOf<WebsitePhotoEdit?>(null)

    /** The name drawn on the design; the piece's own to start with. */
    var designName by mutableStateOf(piece.name)

    val weightOK: Boolean get() = validWeight(weight)
    val grams: String get() = weight.trim() + "g"
    val stamps: Boolean get() = design == null && overlay && weightOK
    val designed: Boolean get() = design?.ready == true

    private fun designHas(vararg binds: String): Boolean =
        design?.doc?.get("layers")?.array?.any { it.s("kind") == "text" && it.s("bind") in binds && !it["hidden"].bool } ?: false

    /** What the design's words read (piece-design.tsx `fields`): the line under the name carries the weight only when nothing else on the photo does. */
    fun designFields(metal: String): Map<String, String> {
        val w = if (weightOK) grams else ""
        val stampedOn = designHas("weight")
        // site-design.ts siteDetailsLine: the Maisons are the great houses' pieces, not the house's own metal.
        val details = listOf(if (piece.collection.contains("maison", ignoreCase = true)) "" else metal, if (stampedOn) "" else w).filter { it.isNotEmpty() }.joinToString(" | ")
        return mapOf("kicker" to piece.collection, "headline" to designName, "weight" to w, "details" to details)
    }

    /** The weight shows on the design: its own stamp, or in the line under the name. */
    val designShowsWeight: Boolean get() = weightOK && designHas("weight", "details")

    /** What the confirm says goes: "The photo with 3.84g on it". */
    val going: String get() = if (designed) "Your design of the photo" else if (stamps) "The photo with $grams on it" else "The photo as it is on the website"

    /** The weight the website keeps when this goes (taheri.shop's own photographs that have none). */
    val newWeight: Double? get() = weightForSite(piece.source, piece.weightGrams, weight)
    val postOnly: Boolean get() = postOnlyWeight(piece.weightGrams, weight)
}

/** The tray (PostTrayModel). [engine] draws the caption's frame, the stamp, the design and the story. */
class PostTrayModel(val engine: DesignEngine, private val scope: CoroutineScope) {
    val cards = mutableStateListOf<PostTrayCard>()
    var active by mutableStateOf<String?>(null)

    /** WhatsApp destination keys, in the order they are offered: the groups, then the channel. */
    var targets by mutableStateOf<List<String>>(emptyList())
        private set

    /** "send" or "queue" while the tray goes. */
    var busy by mutableStateOf<String?>(null)
        private set
    var instagram by mutableStateOf(MarketingValue.NULL)
        private set
    var posting by mutableStateOf(MarketingValue.NULL)
        private set

    private val photos = HashMap<String, ByteArray>()
    private var ready = false
    private val store: PostsState get() = PostsStore.state.value

    val audience: PostAudience get() = store.audience
    val activeCard: PostTrayCard? get() = cards.firstOrNull { it.id == active } ?: cards.firstOrNull()
    val canSend: Boolean get() = audience.canSend && targets.isNotEmpty() && cards.isNotEmpty() && busy == null
    val metal: String get() = posting.s("metal")

    /** The keys of the places a post can go, in the order they are offered. */
    private val keys: List<String> get() = audience.groups.map { it.key } + (if (audience.channelName != null) listOf("channel") else emptyList())

    // MARK: Starting

    suspend fun setUp() {
        if (ready) return
        ready = true
        coroutineScope {
            val pieces = launch { PostsStore.load() }
            val places = launch { PostsStore.refreshAudience() }
            val config = async { try { MarketingRequest.get("/api/app/website") } catch (e: CancellationException) { throw e } catch (e: Exception) { null } }
            val ig = async { try { MarketingRequest.get("/api/instagram/status") } catch (e: CancellationException) { throw e } catch (e: Exception) { null } }
            pieces.join()
            places.join()
            posting = config.await()?.get("posting") ?: MarketingValue.NULL
            instagram = ig.await() ?: MarketingValue.NULL
        }
        chooseTargets()
        for (c in cards.toList()) refresh(c)
    }

    private fun chooseTargets() {
        val saved = (Prefs.string(TARGETS_KEY) ?: "").split(',').filter { it in keys }
        targets = if (saved.isEmpty()) audience.groups.take(1).map { it.key } + (if (audience.channelName != null) listOf("channel") else emptyList()) else saved
    }

    /** Where a post goes is this phone's choice, kept for the next sitting (the web keeps it on the device too). */
    fun toggle(key: String) {
        val next = if (key in targets) targets.filter { it != key } else targets + key
        targets = keys.filter { it in next }
        Prefs.putString(TARGETS_KEY, targets.joinToString(","))
    }

    /** A destination's name on the page: "the channel", or the group's label. */
    fun label(key: String): String = if (key == "channel") "the channel" else audience.groups.firstOrNull { it.key == key }?.label ?: key

    fun reach(key: String): Int? = if (key == "channel") audience.channelFollowers else audience.groups.firstOrNull { it.key == key }?.size

    /** The posting lines' checks that would stop a WhatsApp send now. */
    val blockers: List<PostCheck> get() = store.failingChecks.filter { it.group == "WhatsApp" }

    // MARK: Picking

    fun has(id: String): Boolean = cards.any { it.id == id }

    /** Into the tray, or out again; null, or why it can't go in. */
    fun pick(p: PostPiece): String? {
        if (busy != null) return null
        if (has(p.id)) { take(p.id); return null }
        if (cards.size >= PostTrayLogic.MAX_PICK) return "${PostTrayLogic.MAX_PICK} at a time. Send or queue these first: the queue can spread them over the day."
        val card = PostTrayCard(p)
        cards.add(card)
        active = p.id
        scope.launch { refresh(card) }
        return null
    }

    fun take(id: String) {
        cards.removeAll { it.id == id }
        if (active == id) active = cards.lastOrNull()?.id
    }

    fun clear() {
        cards.clear()
        active = null
    }

    /** A piece at random from the website: not one posted lately, unless there are none. */
    private fun randomPiece(): PostPiece? {
        val open = store.pieces.filter { !has(it.id) }
        val fresh = open.filter { (MarketingTime.daysAgo(store.posted[it.id]) ?: PostTrayLogic.FRESH_DAYS) >= PostTrayLogic.FRESH_DAYS }
        val from = fresh.ifEmpty { open }
        return if (from.isEmpty()) null else from[Random.nextInt(from.size)]
    }

    fun shuffle(): String? {
        if (cards.size >= PostTrayLogic.MAX_PICK) return "${PostTrayLogic.MAX_PICK} at a time."
        val p = randomPiece() ?: return "Nothing to shuffle."
        return pick(p)
    }

    /** Another piece in this card's place. */
    fun another(card: PostTrayCard): String? {
        val p = randomPiece()
        val i = cards.indexOfFirst { it.id == card.id }
        if (p == null || i < 0) return "Nothing else to shuffle to."
        val next = PostTrayCard(p)
        cards[i] = next
        active = p.id
        scope.launch { refresh(next) }
        return null
    }

    // MARK: A card's words and photo

    /** The house's caption, and the photo with the weight on it, as they are now. */
    suspend fun refresh(card: PostTrayCard) {
        // Read again after the engine answers: what the counter typed meanwhile is kept.
        if (!card.edited) {
            val words = try { houseCaption(card) } catch (e: CancellationException) { throw e } catch (e: Exception) { null }
            if (words != null && !card.edited) card.caption = words
        }
        val data = if (card.stamps) try { outgoing(card) } catch (e: CancellationException) { throw e } catch (e: Exception) { null } else null
        card.preview = data?.let { d -> withContext(Dispatchers.Default) { MarketingPhotos.decode(d, 1200)?.asImageBitmap() } }
    }

    /** sitePieceCaption with this house's lines (/api/app/website `posting`), the weight as typed and the AI's words if used. */
    private suspend fun houseCaption(card: PostTrayCard): String {
        val p = card.piece
        val piece = mapOf(
            "name" to p.name, "url" to p.url, "facts" to (card.aiFacts?.let { listOf(it) } ?: p.facts), "about" to (card.aiLine ?: p.about),
            "weightGrams" to if (card.weightOK) PostTrayLogic.typedGrams(card.weight) else null,
        )
        val context = mapOf(
            "metal" to posting.s("metal"), "tagline" to posting.s("tagline"), "footer" to posting.s("footer"),
            "whatsappNumbers" to posting["whatsappNumbers"].array.map { it.string },
        )
        return engine.run(MarketingValue.NULL, emptyMap(), emptyMap(), mapOf("action" to "siteCaption", "sitePiece" to piece, "context" to context)).s("caption")
    }

    suspend fun houseWords(card: PostTrayCard) {
        card.aiLine = null
        card.aiFacts = null
        card.edited = false
        refresh(card)
    }

    /** The AI's line and facts for the piece (/api/website/site-pieces/caption), put in the house's frame. */
    suspend fun writeWithAI(card: PostTrayCard) {
        val d = MarketingRequest.send("/api/website/site-pieces/caption", mapOf("id" to card.id, "weight" to if (card.weightOK) card.grams else ""))
        card.aiLine = d.s("line")
        card.aiFacts = d.s("facts")
        card.edited = false
        refresh(card)
    }

    /** The website's photograph, fetched once through the ERP (the site doesn't share it with the app). */
    suspend fun photo(id: String): ByteArray {
        photos[id]?.let { return it }
        val data = ErpApi.shared.bytes("/api/website/site-pieces/image?id=${MarketingKit.escape(id)}", timeoutMs = 120_000)
        photos[id] = data
        return data
    }

    /** The photo that goes out: stamped with the weight while the overlay is on, else the site's own. */
    suspend fun outgoing(card: PostTrayCard): ByteArray {
        val d = card.design
        if (d != null && d.ready) return d.squareJpeg(card.designFields(metal))
        val base = photo(card.id)
        if (!card.stamps) return base
        val key = card.grams + "|" + card.ink
        card.stamped?.let { if (it.first == key) return it.second }
        val r = engine.run(MarketingValue.NULL, mapOf("site" to base), emptyMap(), mapOf("action" to "stamp", "photoId" to "site", "text" to card.grams, "colour" to card.ink))
        val data = DesignProtocol.imageBytes(r) ?: throw ErpApi.Failure(0, "Could not put the weight on.")
        card.stamped = key to data
        return data
    }

    /**
     * Crop & design, the first time on the layout this piece starts with (the weight on it where the card stamped it). Null,
     * or why the photo didn't come.
     */
    suspend fun startDesign(card: PostTrayCard): String? {
        val edit = card.design ?: WebsitePhotoEdit(card.id, engine)
        card.design = edit
        try {
            val base = photo(card.id)
            edit.beginSquare(card.piece, base, card.overlay && card.weightOK, card.designFields(metal))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            card.design = null
            return e.message ?: "Something went wrong."
        }
        val problem = edit.problem
        if (problem != null && !edit.ready) {
            card.design = null
            return problem
        }
        return null
    }

    /** Back to the photo as the website has it: the design is dropped. */
    fun dropDesign(card: PostTrayCard) {
        card.design = null
        card.designName = card.piece.name
    }

    /** The piece as a 9:16 story: the photo that would go to WhatsApp, whole, with the name and the weight. */
    suspend fun story(card: PostTrayCard): ByteArray {
        val photo = outgoing(card)
        val headline = if (card.designed) (card.designName.trim().ifEmpty { card.piece.name }) else card.piece.name
        val r = engine.run(
            MarketingValue.NULL, mapOf("site" to photo), emptyMap(),
            mapOf(
                "action" to "siteStory", "photoId" to "site", "headline" to headline, "collection" to card.piece.collection,
                "metal" to posting.s("metal"), "weight" to if (card.weightOK) card.grams else "",
            ),
        )
        return DesignProtocol.imageBytes(r) ?: throw ErpApi.Failure(0, "Couldn't make the story.")
    }

    // MARK: Sending

    /** How a send or a queue went, said once at the end. */
    class Outcome(val notes: List<Note> = emptyList())

    /**
     * Every piece in the tray, one after another, each to the chosen places. Stops at the first that fails; one that some places
     * took has gone, so it leaves the tray (sending it again would post twice).
     */
    suspend fun send(): Outcome {
        busy = "send"
        try {
            val done = ArrayList<PostTrayCard>()
            val partly = ArrayList<String>()
            val weighed = ArrayList<String>()
            val unweighed = ArrayList<String>()
            var stopped: Pair<String, String>? = null
            val places = targets
            // A card whose caption the engine never wrote (it was still starting) gets it now: nothing goes without one.
            for (card in cards.toList()) if (card.caption.isEmpty() && !card.edited) refresh(card)
            for (card in cards.toList()) {
                card.sending = true
                card.failed = null
                try {
                    val photo = outgoing(card)
                    val fields = listOf("caption" to card.caption, "sitePiece" to card.id, "targets" to places.joinToString(","))
                    val text = ErpApi.shared.upload(
                        "/api/website/post", fields, listOf(ErpApi.FormFile("file", PostTrayLogic.slug(card.piece) + ".jpg", "image/jpeg", photo)), timeoutMs = 300_000,
                    )
                    val missed = MarketingValue.parse(text)["results"].array.filter { !it["ok"].bool }
                    missed.firstOrNull()?.let { first ->
                        partly.add("${card.piece.name} didn't go to ${PostTrayLogic.listOf(missed.map { r -> label(r.s("key")) })}: ${first.s("error")}")
                    }
                    when (keepWeight(card)) {
                        true -> weighed.add(card.piece.name)
                        false -> unweighed.add(card.piece.name)
                        null -> Unit
                    }
                    done.add(card)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val why = e.message ?: "Something went wrong."
                    card.failed = why
                    stopped = card.piece.name to why
                    break
                } finally {
                    card.sending = false
                }
            }
            cards.removeAll { c -> done.any { it === c } }
            val a = active
            if (a != null && !has(a)) active = cards.firstOrNull()?.id
            if (done.isNotEmpty()) PostsStore.afterSending()

            val notes = ArrayList<Note>()
            val n = done.size
            val s = stopped
            if (s != null) {
                notes.add(Note(if (n > 0) "$n sent, then ${s.first} didn't go" else "${s.first} didn't go", s.second + if (cards.size > 1) " The rest are still in the tray." else "", failed = true))
            } else if (partly.isNotEmpty()) {
                notes.add(Note("Sent $n ${PostTrayLogic.noun(n)}, not everywhere", partly.joinToString(" · "), failed = true))
            } else if (n > 0) {
                notes.add(Note("Sent $n ${PostTrayLogic.noun(n)} to ${PostTrayLogic.listOf(places.map { label(it) })}", if (n == 1) "${done[0].piece.name}, with its link." else "Each with its own caption and link."))
            }
            if (weighed.isNotEmpty()) {
                notes.add(Note("Weight saved on ${store.siteName}", "${PostTrayLogic.listOf(weighed)} now ${if (weighed.size == 1) "shows its" else "show their"} weight on the website."))
            }
            if (unweighed.isNotEmpty()) {
                notes.add(Note("The weight wasn't saved on ${store.siteName}", "${PostTrayLogic.listOf(unweighed)}: add it in Website → Weights.", failed = true))
            }
            return Outcome(notes)
        } finally {
            busy = null
        }
    }

    /** Into the queue, to send later or spread over the day: each piece exactly as its card makes it now. */
    suspend fun queue(): Outcome {
        busy = "queue"
        try {
            val done = ArrayList<PostTrayCard>()
            var problem: String? = null
            for (card in cards.toList()) if (card.caption.isEmpty() && !card.edited) refresh(card)
            for (card in cards.toList()) {
                card.sending = true
                card.failed = null
                try {
                    val photo = outgoing(card)
                    val thumb = withContext(Dispatchers.Default) { MarketingPhotos.decode(photo, 240)?.let { MarketingPhotos.jpeg(it, 240, 70) } }
                    PostQueueMaker.queue(
                        headline = card.piece.name, caption = card.caption, fileBase = PostTrayLogic.slug(card.piece), sitePiece = card.id,
                        whatsapp = targets, count = 1, images = mapOf("wa-0" to photo), thumb = thumb, dueAt = null,
                    )
                    // Queued is as good as typed in for good: the website keeps the weight now, not when the post goes.
                    keepWeight(card)
                    done.add(card)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    val why = e.message ?: "Something went wrong."
                    card.failed = why
                    problem = why
                    break
                } finally {
                    card.sending = false
                }
            }
            cards.removeAll { c -> done.any { it === c } }
            val a = active
            if (a != null && !has(a)) active = cards.firstOrNull()?.id
            PostsStore.refreshQueue()
            val notes = ArrayList<Note>()
            if (done.isNotEmpty()) {
                notes.add(Note("${done.size} ${PostTrayLogic.noun(done.size)} in the queue", "Send them now, give each a time, or spread them over the day: they go by themselves."))
            }
            if (problem != null) notes.add(Note("Could not queue it", problem, failed = true))
            return Outcome(notes)
        } finally {
            busy = null
        }
    }

    /**
     * A weight typed for a piece the website has none for, kept there as Website → Weights keeps it. The post has gone either
     * way: true saved, false not, null when there was nothing to keep.
     */
    private suspend fun keepWeight(card: PostTrayCard): Boolean? {
        val grams = card.newWeight ?: return null
        return try {
            ErpApi.shared.send("/api/website/pieces", "PUT", mapOf("key" to card.id, "weightGrams" to grams))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
    }

    companion object {
        const val TARGETS_KEY = "erp.postTargets"
    }
}

/** The post queue as Post a piece and the Board call it (DesignSend.queue): the entry, its pictures, then "ready" (held), then a time if there is one. */
object PostQueueMaker {
    suspend fun queue(
        headline: String, caption: String, fileBase: String, sitePiece: String?, whatsapp: List<String>, count: Int,
        images: Map<String, ByteArray>, thumb: ByteArray?, dueAt: String?,
    ): String {
        var qid: String? = null
        try {
            val counts = mapOf("site" to 0, "wa" to if (whatsapp.isEmpty()) 0 else count, "story" to images.containsKey("story"))
            val body = LinkedHashMap<String, Any?>()
            body["headline"] = headline
            body["caption"] = caption
            body["fileBase"] = fileBase
            body["counts"] = counts
            body["instagram"] = images.containsKey("story")
            body["whatsapp"] = whatsapp
            body["website"] = null
            if (thumb != null) body["thumb"] = java.util.Base64.getEncoder().encodeToString(thumb)
            if (!sitePiece.isNullOrEmpty()) body["sitePiece"] = sitePiece
            val made = MarketingRequest.send("/api/website/post/queue", body)
            qid = made["item"].s("id")
            val id = qid
            if (id.isEmpty()) throw ErpApi.Failure(0, "The queue gave no entry.")
            for (key in images.keys.sorted()) {
                ErpApi.shared.upload("/api/website/post/queue/$id", listOf("key" to key), listOf(ErpApi.FormFile("file", "$key.jpg", "image/jpeg", images.getValue(key))))
            }
            // 'ready' puts the draft in the queue, held; a time then schedules it.
            MarketingRequest.send("/api/website/post/queue/$id", mapOf("action" to "ready"), method = "PATCH")
            if (dueAt != null) MarketingRequest.send("/api/website/post/queue/$id", mapOf("action" to "schedule", "dueAt" to dueAt), method = "PATCH")
            return id
        } catch (e: Exception) {
            // Nothing has gone: take the half-made entry out so the retry starts clean.
            val id = qid
            if (!id.isNullOrEmpty()) try { MarketingRequest.send("/api/website/post/queue/$id", method = "DELETE") } catch (x: Exception) { }
            throw e
        }
    }
}
