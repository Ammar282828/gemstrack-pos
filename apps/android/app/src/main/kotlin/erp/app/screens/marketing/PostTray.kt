package erp.app.screens.marketing

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.ErpApp
import erp.app.ui.Note
import erp.app.ui.NoteState
import erp.core.logic.Album
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

    /** The photos that go, in order: the lead (this card's own photo), the piece's others, then any added (1 to Album.max). */
    val album = mutableStateListOf(PostAlbumPhoto.start(piece))

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
    val going: String
        get() {
            val lead = if (designed) "Your design of the photo" else if (stamps) "The photo with $grams on it" else "The photo as it is on the website"
            return lead + if (album.size > 1) ", then ${album.size - 1} more (${Album.photosLabel(album.size)} in all)" else ""
        }

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

    /** "Instagram post" is chosen: the photos also go as one carousel (a device choice, kept for the next sitting). */
    var instagramPost by mutableStateOf(false)
        private set

    private val photos = HashMap<String, ByteArray>()
    private var ready = false
    private val store: PostsState get() = PostsStore.state.value

    val audience: PostAudience get() = store.audience
    val activeCard: PostTrayCard? get() = cards.firstOrNull { it.id == active } ?: cards.firstOrNull()

    /** Instagram only while it is connected (the chip is hidden otherwise). */
    val toInstagram: Boolean get() = instagramPost && instagram["connected"].bool

    /** WhatsApp places to send to: needs the community, as the web's `audience.community`. */
    val whatsappPlaces: List<String> get() = if (audience.canSend) targets else emptyList()
    val canSend: Boolean get() = (whatsappPlaces.isNotEmpty() || toInstagram) && cards.isNotEmpty() && busy == null

    /** Where a send goes, in words: the WhatsApp places, then Instagram. */
    val placeNames: List<String> get() = whatsappPlaces.map { label(it) } + (if (toInstagram) listOf("Instagram") else emptyList())
    val metal: String get() = posting.s("metal")

    fun chooseInstagram() {
        instagramPost = !instagramPost
        Prefs.putBool(INSTAGRAM_KEY, instagramPost)
    }

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
        instagramPost = Prefs.bool(INSTAGRAM_KEY) ?: false
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
    suspend fun photo(id: String, n: Int? = null): ByteArray {
        val key = if (n != null) "$id#$n" else id
        photos[key]?.let { return it }
        val more = if (n != null) "&photo=$n" else ""
        val data = ErpApi.shared.bytes("/api/website/site-pieces/image?id=${MarketingKit.escape(id)}$more", timeoutMs = 120_000)
        photos[key] = data
        return data
    }

    // MARK: A card's photos (piece-photos.tsx)

    /** Every photo, in order, as it goes: the lead as the card makes it (design, weight), the rest as the site or the phone has them. */
    suspend fun albumData(card: PostTrayCard): List<ByteArray> = card.album.toList().map { x ->
        when (val k = x.kind) {
            is PostAlbumPhoto.Kind.Lead -> outgoing(card)
            is PostAlbumPhoto.Kind.Angle -> photo(card.id, k.n)
            is PostAlbumPhoto.Kind.Site -> photo(k.id)
            is PostAlbumPhoto.Kind.Device -> k.data
        }
    }

    /** The first photo: what a one-photo place (the Instagram story) takes. */
    suspend fun firstPhoto(card: PostTrayCard): ByteArray {
        val x = card.album.firstOrNull() ?: return outgoing(card)
        return when (val k = x.kind) {
            is PostAlbumPhoto.Kind.Lead -> outgoing(card)
            is PostAlbumPhoto.Kind.Angle -> photo(card.id, k.n)
            is PostAlbumPhoto.Kind.Site -> photo(k.id)
            is PostAlbumPhoto.Kind.Device -> k.data
        }
    }

    fun move(card: PostTrayCard, id: String, step: Int) {
        val i = card.album.indexOfFirst { it.id == id }
        val j = i + step
        if (i < 0 || j < 0 || j >= card.album.size) return
        val moved = card.album[i]
        card.album[i] = card.album[j]
        card.album[j] = moved
    }

    /** The lead stays: it is the card's own photo (design, weight). */
    fun remove(card: PostTrayCard, id: String) {
        val x = card.album.firstOrNull { it.id == id } ?: return
        if (card.album.size > 1 && !x.isLead) card.album.remove(x)
    }

    /** Another website piece's photograph in, or out again; null, or why it can't go in. */
    fun toggleSite(card: PostTrayCard, p: PostPiece): String? {
        if (card.album.any { it.pieceID == p.id }) {
            card.album.removeAll { it.pieceID == p.id }
            return null
        }
        if (card.album.size >= Album.max) return "${Album.max} photos at most"
        card.album.add(PostAlbumPhoto("site-" + p.id, PostAlbumPhoto.Kind.Site(p.id), p.thumb, null, p.name))
        return null
    }

    /** Photos from this phone, as JPEGs; null, or why not all went in. */
    fun addDevice(card: PostTrayCard, jpegs: List<ByteArray>): String? {
        var refused = false
        for (data in jpegs) {
            if (card.album.size >= Album.max) { refused = true; break }
            val shown = MarketingPhotos.decode(data, 400)?.asImageBitmap()
            card.album.add(PostAlbumPhoto("device-" + java.util.UUID.randomUUID(), PostAlbumPhoto.Kind.Device(data), null, shown, "A photo from this phone"))
        }
        return if (refused) "${Album.max} photos at most" else null
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
        val photo = firstPhoto(card)
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

    /** A card with everything it sends, read now: the tray can be left while the uploads go (the engine is the screen's). */
    private class Prepared(val card: PostTrayCard, val blobs: List<ByteArray>, val caption: String)

    /** Reads every card's caption and photos. A card that can't be read stops the batch, still in the tray, saying why. */
    private suspend fun prepare(batch: List<PostTrayCard>): Pair<List<Prepared>, Note?> {
        // A card whose caption the engine never wrote (it was still starting) gets it now: nothing goes without one.
        for (card in batch) if (card.caption.isEmpty() && !card.edited) refresh(card)
        val out = ArrayList<Prepared>()
        for (card in batch) {
            card.sending = true
            card.failed = null
            try {
                out.add(Prepared(card, albumData(card), card.caption))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val why = e.message ?: "Something went wrong."
                card.failed = why
                return out to Note("${card.piece.name} didn't go", why + if (batch.size > 1) " The rest are still in the tray." else "", failed = true)
            } finally {
                card.sending = false
            }
        }
        return out to null
    }

    /**
     * Every piece in the tray, one after another, each to the chosen places. The photos are read here, then the tray clears at
     * once and the uploads run in the app's own scope (owner, 2026-10-23: instant); "Posted to …" or the place that failed comes
     * back as a toast through [note]. Stops at the first that fails; one that some places took has gone, so it is not sent
     * again, and the ones that did not go come back to the tray to be sent again.
     */
    suspend fun send(note: NoteState): Outcome {
        val places = whatsappPlaces
        val toIg = toInstagram
        val names = placeNamesSent(places, toIg)
        busy = "send"
        val batch = cards.toList()
        val prepared: List<Prepared>
        try {
            val (ready, problem) = prepare(batch)
            if (problem != null) return Outcome(listOf(problem))
            prepared = ready
        } finally {
            busy = null
        }
        if (prepared.isEmpty()) return Outcome()
        cards.clear()
        active = null
        val finished = HashSet<String>()
        ErpApp.scope.launch {
            try {
                note.show(Note(deliver(prepared, places, toIg, finished)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val why = e.message ?: "Something went wrong."
                // Back in the tray, to send again: what has gone is not in it.
                val left = batch.filter { it.id !in finished }
                left.forEach { it.failed = why }
                cards.addAll(left.filter { c -> cards.none { it.id == c.id } })
                if (active == null) active = cards.firstOrNull()?.id
                note.show(Note("Not all of it went", why, failed = true))
            }
        }
        return Outcome(listOf(Note("Sending to ${names.size} ${if (names.size == 1) "place" else "places"}…", "You can carry on: it says here when it has gone.")))
    }

    /** The send itself. [finished] is what has gone already, so a second go skips it. The words said when all went; throws when not. */
    private suspend fun deliver(batch: List<Prepared>, places: List<String>, toIg: Boolean, finished: MutableSet<String>): String {
        val done = ArrayList<PostTrayCard>()
        val partly = ArrayList<String>()
        val weighed = ArrayList<String>()
        val unweighed = ArrayList<String>()
        val igSaid = ArrayList<String>()
        var stopped: Pair<String, String>? = null
        for (item in batch) {
            val card = item.card
            if (card.id in finished) continue
            try {
                val blobs = item.blobs
                var wentSomewhere = false
                if (places.isNotEmpty()) {
                    val sent = sendWhatsApp(card, item.caption, blobs, places)
                    wentSomewhere = sent.got.isNotEmpty()
                    // Some places took it and some didn't: it has gone, so it is not sent again.
                    val missed = places.filter { sent.got[it] == null }
                    missed.firstOrNull()?.let { first ->
                        partly.add("${card.piece.name} didn't go to ${PostTrayLogic.listOf(missed.map { label(it) })}: ${sent.failed[first] ?: "Send failed"}")
                    }
                    val short = places.filter { (sent.got[it] ?: 0) in 1 until blobs.size }
                    short.firstOrNull()?.let { first ->
                        partly.add("${PostTrayLogic.listOf(short.map { label(it) })} got ${sent.got[first] ?: 0} of ${blobs.size} photos of ${card.piece.name}: ${sent.failed[first] ?: "Send failed"}")
                    }
                }
                if (toIg) {
                    try {
                        val ig = sendInstagram(card, item.caption, blobs)
                        wentSomewhere = true
                        if (ig.second > 0) partly.add("Instagram took the first ${ig.first} of ${ig.first + ig.second} photos of ${card.piece.name} (its limit).")
                        else if (ig.first > 1) igSaid.add("Instagram: ${Album.photosLabel(ig.first)} as one post.")
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        // WhatsApp has it already: said beside it, not fatal. Instagram alone: the batch stops.
                        if (!wentSomewhere) throw e
                        partly.add("${card.piece.name} didn't go to Instagram: ${e.message ?: "Something went wrong."}")
                    }
                }
                when (keepWeight(card)) {
                    true -> weighed.add(card.piece.name)
                    false -> unweighed.add(card.piece.name)
                    null -> Unit
                }
                finished.add(card.id)
                done.add(card)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                stopped = card.piece.name to (e.message ?: "Something went wrong.")
                break
            }
        }
        if (done.isNotEmpty()) PostsStore.afterSending()
        val n = done.size
        stopped?.let { throw ErpApi.Failure(400, (if (n > 0) "$n sent, then ${it.first} didn't go: " else "${it.first} didn't go: ") + it.second) }
        if (partly.isNotEmpty()) throw ErpApi.Failure(400, "Sent $n ${PostTrayLogic.noun(n)}, not everywhere: " + partly.joinToString(" · "))
        var said = if (n == 0) "Nothing left to send" else "Posted $n ${PostTrayLogic.noun(n)} to ${PostTrayLogic.listOf(placeNamesSent(places, toIg))}"
        if (igSaid.isNotEmpty()) said += ". " + igSaid.joinToString(" ")
        if (unweighed.isNotEmpty()) said += ". The weight wasn't saved on ${store.siteName} for ${PostTrayLogic.listOf(unweighed)}: add it in Website → Weights."
        else if (weighed.isNotEmpty()) said += ". Weight saved on ${store.siteName}."
        return said
    }

    private fun placeNamesSent(places: List<String>, toIg: Boolean): List<String> = places.map { label(it) } + (if (toIg) listOf("Instagram") else emptyList())

    /** What each place got of a piece's photos, and why one stopped. */
    private class WhatsAppResult(val got: Map<String, Int>, val failed: Map<String, String>)

    /**
     * One piece's photos to the chosen WhatsApp places: photo by photo, each to every place still going, the caption under the
     * first only (album.ts), one request a photo. A place that fails a photo gets none of the rest.
     */
    private suspend fun sendWhatsApp(card: PostTrayCard, caption: String, blobs: List<ByteArray>, places: List<String>): WhatsAppResult {
        val captions = Album.captions(caption, blobs.size)
        val base = PostTrayLogic.slug(card.piece)
        val failed = LinkedHashMap<String, String>()
        val got = LinkedHashMap<String, Int>()
        for (i in blobs.indices) {
            val live = Album.placesFor(places, failed.keys)
            if (live.isEmpty()) break
            val fields = listOf("caption" to captions[i], "sitePiece" to card.id, "targets" to live.joinToString(","))
            val file = ErpApi.FormFile("file", Album.fileName(base, i), "image/jpeg", blobs[i])
            val text = try {
                ErpApi.shared.upload("/api/website/post", fields, listOf(file), timeoutMs = 300_000)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Nothing took the first photo: nothing went, and the batch stops here. Later: the places left miss the rest.
                if (i == 0) throw e
                for (k in live) failed[k] = e.message ?: "Send failed"
                break
            }
            val results = MarketingValue.parse(text)["results"].array
            if (results.isEmpty()) for (k in live) got[k] = (got[k] ?: 0) + 1
            for (r in results) {
                val key = r.s("key")
                if (r["ok"].bool) got[key] = (got[key] ?: 0) + 1
                else failed[key] = r.s("error").ifEmpty { "Send failed" }
            }
        }
        return WhatsAppResult(got, failed)
    }

    /**
     * One piece's photos as one Instagram post: a carousel of the first ten, the caption once, WhatsApp's markers off. How many
     * photos went in the post, and how many were left out.
     */
    private suspend fun sendInstagram(card: PostTrayCard, caption: String, blobs: List<ByteArray>): Pair<Int, Int> {
        val plan = Album.carouselPlan(blobs.size)
        val base = PostTrayLogic.slug(card.piece)
        val files = (0 until plan.take).map { i -> ErpApi.FormFile("file", Album.fileName(base, i), "image/jpeg", feedJpeg(blobs[i])) }
        val fields = listOf("caption" to Album.instagramText(caption), "fit" to "crop", "sitePiece" to card.id)
        val answer = MarketingValue.parse(ErpApi.shared.upload("/api/instagram/post", fields, files, timeoutMs = 300_000))
        // The answer's own count wins; a one-photo post says neither.
        val took = if (answer["photos"].isNull) plan.take else answer.n("photos").toInt()
        val left = if (answer["dropped"].isNull) plan.dropped else answer.n("dropped").toInt()
        return took to left
    }

    /** A photo as Instagram's feed takes it: JPEG, at most 1440 px on its long side. */
    private suspend fun feedJpeg(data: ByteArray): ByteArray = withContext(Dispatchers.Default) {
        MarketingPhotos.decode(data, 1440)?.let { MarketingPhotos.jpeg(it, 1440, 90) } ?: data
    }

    /**
     * Into the queue, to send later or spread over the day: each piece exactly as its card makes it now, every photo of it (up to
     * Album.max), with an Instagram post when it is chosen. The photos are read here, then the tray clears at once and the queue
     * is filled in the app's own scope; what did not get in comes back to the tray.
     */
    suspend fun queue(note: NoteState): Outcome {
        val places = whatsappPlaces
        val toIg = toInstagram
        busy = "queue"
        val batch = cards.toList()
        val prepared: List<Prepared>
        val thumbs = HashMap<String, ByteArray?>()
        try {
            val (ready, problem) = prepare(batch)
            if (problem != null) return Outcome(listOf(problem))
            prepared = ready
            for (p in prepared) thumbs[p.card.id] = p.blobs.firstOrNull()?.let { d -> withContext(Dispatchers.Default) { MarketingPhotos.decode(d, 240)?.let { MarketingPhotos.jpeg(it, 240, 70) } } }
        } finally {
            busy = null
        }
        if (prepared.isEmpty()) return Outcome()
        cards.clear()
        active = null
        val finished = HashSet<String>()
        ErpApp.scope.launch {
            try {
                for (item in prepared) {
                    enqueue(item.card, item.caption, item.blobs, thumbs[item.card.id], places, toIg)
                    // Queued is as good as typed in for good: the website keeps the weight now, not when the post goes.
                    keepWeight(item.card)
                    finished.add(item.card.id)
                }
                PostsStore.refreshQueue()
                note.show(Note("${batch.size} ${PostTrayLogic.noun(batch.size)} in the queue"))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val why = e.message ?: "Something went wrong."
                val left = batch.filter { it.id !in finished }
                left.forEach { it.failed = why }
                cards.addAll(left.filter { c -> cards.none { it.id == c.id } })
                if (active == null) active = cards.firstOrNull()?.id
                PostsStore.refreshQueue()
                note.show(Note("Could not queue it", why, failed = true))
            }
        }
        return Outcome(listOf(Note("Queueing ${batch.size} ${PostTrayLogic.noun(batch.size)}…", "They go to the queue in the background.")))
    }

    /**
     * The queue's entry for a piece (PostQueueMaker's steps): the entry, each photo as "wa-<i>", then "ready" (held). A failure
     * takes the half-made entry out so the retry starts clean.
     */
    private suspend fun enqueue(card: PostTrayCard, caption: String, blobs: List<ByteArray>, thumb: ByteArray?, places: List<String>, instagramPost: Boolean) {
        var qid: String? = null
        try {
            val body = LinkedHashMap<String, Any?>()
            body["headline"] = card.piece.name
            body["caption"] = caption
            body["fileBase"] = PostTrayLogic.slug(card.piece)
            body["counts"] = mapOf("site" to 0, "wa" to blobs.size, "story" to false)
            body["instagram"] = false
            body["whatsapp"] = places
            body["website"] = null
            body["sitePiece"] = card.id
            if (instagramPost) body["instagramPost"] = true
            if (thumb != null) body["thumb"] = java.util.Base64.getEncoder().encodeToString(thumb)
            val made = MarketingRequest.send("/api/website/post/queue", body)
            val id = made["item"].s("id")
            qid = id
            if (id.isEmpty()) throw ErpApi.Failure(0, "The queue gave no entry.")
            blobs.forEachIndexed { i, data ->
                val key = "wa-$i"
                ErpApi.shared.upload("/api/website/post/queue/$id", listOf("key" to key), listOf(ErpApi.FormFile("file", "$key.jpg", "image/jpeg", data)))
            }
            MarketingRequest.send("/api/website/post/queue/$id", mapOf("action" to "ready"), method = "PATCH")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val id = qid
            if (!id.isNullOrEmpty()) try { MarketingRequest.send("/api/website/post/queue/$id", method = "DELETE") } catch (x: Exception) { }
            throw e
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
        const val INSTAGRAM_KEY = "erp.postInstagramPost"
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
