package erp.app.screens.marketing

import erp.core.Container
import erp.core.Decodable

// The Website screens' answers, read as leniently as the web reads them: a missing or odd field gives a default,
// never an error that would empty a screen (WebsiteModels.swift, CONVENTIONS.md rule 3). Field names are the routes' own.

private fun ints(c: Container, key: String): List<Int> = c.list(key) { (it as? Number)?.toDouble()?.toInt() }

// MARK: Add photos (/api/website/photos, /api/website/photos/names)

/** A collection a photograph can go into ("Earrings/Jhumki"), with how many pieces it holds today. */
data class WebsiteCollection(
    val collection: String,
    val category: String,
    val count: Int,
    /** "Category/Collection": where a new photo goes. */
    val folder: String,
    /** Where the collection's page is, when the site says (its own catalog-tree.json). */
    val path: String?,
) {
    val id: String get() = folder

    companion object : Decodable<WebsiteCollection> {
        override fun fromMap(m: Map<String, Any?>): WebsiteCollection {
            val c = Container(m)
            return WebsiteCollection(c.string("collection", ""), c.string("category", ""), c.int("count") ?: 0, c.string("folder", ""), c.string("path"))
        }
    }
}

data class WebsiteCollectionsAnswer(
    val collections: List<WebsiteCollection>,
    /** The site's upload secret is set on this ERP: until it is, nothing can be sent. */
    val configured: Boolean,
) {
    companion object : Decodable<WebsiteCollectionsAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteCollectionsAnswer {
            val c = Container(m)
            return WebsiteCollectionsAnswer(c.list("collections", WebsiteCollection).filter { it.folder.isNotEmpty() }, c.bool("configured", true))
        }
    }
}

/** Whether a collection names its photographs by house and model (The Maisons), and the houses. */
data class WebsiteMaisonAnswer(val maison: Boolean, val houses: List<String>) {
    companion object : Decodable<WebsiteMaisonAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteMaisonAnswer {
            val c = Container(m)
            return WebsiteMaisonAnswer(c.bool("maison", false), c.strings("houses"))
        }
    }
}

/** Every photo's file name for a Maisons tray, in its order (lib/website/maison-batch.ts). */
data class WebsiteMaisonNames(val maison: Boolean, val names: List<String>) {
    companion object : Decodable<WebsiteMaisonNames> {
        override fun fromMap(m: Map<String, Any?>): WebsiteMaisonNames {
            val c = Container(m)
            return WebsiteMaisonNames(c.bool("maison", false), c.strings("names"))
        }
    }
}

/** A photograph the site took (lib/website/upload.ts `SiteUpload`): its key, which the set of the day uses. */
data class WebsiteUploaded(val rel: String, val collection: String) {
    companion object : Decodable<WebsiteUploaded> {
        override fun fromMap(m: Map<String, Any?>): WebsiteUploaded {
            val c = Container(m)
            return WebsiteUploaded(c.string("rel", ""), c.string("collection", ""))
        }
    }
}

/** The AI's retouch (/api/website/post/ai, op retouch): the new photograph and the "same piece?" check. */
class WebsiteRetouched(
    val data: ByteArray?,
    val samePiece: Boolean?,
    val confidence: Double?,
    val differences: List<String>,
    val steps: List<String>,
    /** The check came back (false when it could not be made). */
    val checked: Boolean,
) {
    /** The web's bar for "it is the same piece": sure, and at least 80% so. */
    val passes: Boolean get() = (samePiece ?: false) && (confidence ?: 0.0) >= 0.8

    companion object : Decodable<WebsiteRetouched> {
        override fun fromMap(m: Map<String, Any?>): WebsiteRetouched {
            val c = Container(m)
            val image = c.obj("image") { (it as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } }
            val bytes = image?.string("data", "")?.let { text ->
                try { java.util.Base64.getMimeDecoder().decode(text) } catch (e: IllegalArgumentException) { null }
            }
            val check = c.obj("check") { (it as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } }
            return WebsiteRetouched(
                data = bytes, samePiece = check?.bool("samePiece", false), confidence = check?.double("confidence", 0.0),
                differences = check?.strings("differences") ?: emptyList(), steps = c.strings("steps"), checked = check != null,
            )
        }
    }
}

// MARK: Photo weights (/api/website/pieces)

/** One catalogue photograph and its weight: from the photo's own label, from the counter, or none yet. */
data class WebsiteWeightPiece(
    val key: String,
    val collection: String,
    val file: String,
    val thumb: String,
    val weightGrams: Double?,
    /** "label" (burned into the photo), "pos" (typed here), or null. */
    val source: String?,
    val labelWeightGrams: Double?,
    val enteredBy: String?,
    val enteredAt: String?,
) {
    companion object : Decodable<WebsiteWeightPiece> {
        override fun fromMap(m: Map<String, Any?>): WebsiteWeightPiece {
            val c = Container(m)
            return WebsiteWeightPiece(
                key = c.string("key", ""), collection = c.string("collection", ""), file = c.string("file", ""), thumb = c.string("thumb", ""),
                weightGrams = c.double("weightGrams")?.takeIf { it > 0 }, source = c.string("source"),
                labelWeightGrams = c.double("labelWeightGrams"), enteredBy = c.string("enteredBy"), enteredAt = c.string("enteredAt"),
            )
        }
    }
}

data class WebsiteWeightsAnswer(val pieces: List<WebsiteWeightPiece>) {
    companion object : Decodable<WebsiteWeightsAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteWeightsAnswer =
            WebsiteWeightsAnswer(Container(m).list("pieces", WebsiteWeightPiece).filter { it.key.isNotEmpty() })
    }
}

// MARK: Edit a piece (/api/website/edits)

/** One taheri.shop tag, in the order the piece page shows them (edit/page.tsx TAGS). */
data class WebsiteTag(val key: String, val label: String)

/**
 * What the site says about a piece (site-pieces.ts `PieceWords`): the catalogue's paragraphs and facts, or taheri.shop's
 * tags. A missing tag reads as empty, as the page reads it.
 */
data class WebsiteWords(
    val name: String = "",
    val about: String = "",
    val facts: List<String> = emptyList(),
    val stone: String = "",
    val metal: String = "",
    val karat: String = "",
    val cut: String = "",
    val style: String = "",
) {
    fun tag(key: String): String = when (key) {
        "stone" -> stone; "metal" -> metal; "karat" -> karat; "cut" -> cut; "style" -> style; else -> ""
    }

    fun withTag(key: String, value: String): WebsiteWords = when (key) {
        "stone" -> copy(stone = value); "metal" -> copy(metal = value); "karat" -> copy(karat = value)
        "cut" -> copy(cut = value); "style" -> copy(style = value); else -> this
    }

    companion object : Decodable<WebsiteWords> {
        /** taheri.shop's tags, in the order the piece page shows them. */
        val tags: List<WebsiteTag> = listOf(
            WebsiteTag("stone", "Stone"), WebsiteTag("metal", "Metal"), WebsiteTag("karat", "Karat"), WebsiteTag("cut", "Cut"), WebsiteTag("style", "Style"),
        )

        override fun fromMap(m: Map<String, Any?>): WebsiteWords {
            val c = Container(m)
            return WebsiteWords(
                c.string("name", ""), c.string("about", ""), c.strings("facts"), c.string("stone", ""), c.string("metal", ""),
                c.string("karat", ""), c.string("cut", ""), c.string("style", ""),
            )
        }
    }
}

/**
 * The counter's change to a piece, as the site keeps it (site-edits.ts `SiteOverride`): which fields it carries, whether
 * the photo was re-made here, and when.
 */
data class WebsiteEditChange(
    val keys: Set<String>,
    val photoEdited: Boolean,
    val at: String?,
    val weightGrams: Double?,
    val weightOnPhoto: Boolean,
) {
    companion object : Decodable<WebsiteEditChange> {
        /** The words the counter can change (edit/page.tsx TEXT_KEYS). */
        val textKeys: Set<String> = setOf("name", "about", "facts", "stone", "metal", "karat", "cut", "style")

        override fun fromMap(m: Map<String, Any?>): WebsiteEditChange {
            val c = Container(m)
            val photo = c.obj("photo") { (it as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } }
            return WebsiteEditChange(m.keys, photo?.bool("edited", false) ?: false, c.string("at"), c.double("weightGrams"), c.bool("weightOnPhoto", false))
        }
    }
}

/** A piece on the house's website with the counter's changes (site-pieces.ts `SitePiece`). */
data class WebsiteEditPiece(
    val id: String,
    val name: String,
    val url: String,
    val image: String,
    val thumb: String,
    val collection: String,
    val weightGrams: Double?,
    /** The photo already shows the weight (taheri.shop's burned-in label). */
    val weightOnPhoto: Boolean,
    val facts: List<String>,
    val imagePath: String?,
    /** "attributes" (taheri.shop: tags, the counter's weights) or "pieces" (the catalogue: paragraphs, facts). */
    val source: String,
    val own: WebsiteWords,
    val words: WebsiteWords,
    val change: WebsiteEditChange?,
    val hidden: Boolean,
    val photoSource: String?,
    val sourceMarked: Boolean,
) {
    /** taheri.shop's photographs carry tags; the catalogue's pieces carry paragraphs and a list of facts. */
    val hasTags: Boolean get() = source == "attributes"
    val photoEdited: Boolean get() = change?.photoEdited ?: false
    val wordsChanged: Boolean get() = (change?.keys ?: emptySet()).any { it in WebsiteEditChange.textKeys }

    /** Anything the counter changed that still shows (edit/page.tsx `changed`). */
    val changed: Boolean get() = photoEdited || wordsChanged || hidden || change?.weightGrams != null

    companion object : Decodable<WebsiteEditPiece> {
        override fun fromMap(m: Map<String, Any?>): WebsiteEditPiece {
            val c = Container(m)
            val image = c.string("image", "")
            val small = c.string("thumb", "")
            val ownWords = c.obj("own", WebsiteWords)
            val shown = c.obj("words", WebsiteWords)
            val blank = WebsiteWords()
            return WebsiteEditPiece(
                id = c.string("id", ""), name = c.string("name", ""), url = c.string("url", ""), image = image,
                thumb = small.ifEmpty { image }, collection = c.string("collection", ""),
                weightGrams = c.double("weightGrams")?.takeIf { it > 0 }, weightOnPhoto = c.bool("weightOnPhoto", false),
                facts = c.strings("facts"), imagePath = c.string("imagePath"), source = c.string("source", "attributes"),
                own = ownWords ?: shown ?: blank, words = shown ?: ownWords ?: blank, change = c.obj("change", WebsiteEditChange),
                hidden = c.bool("hidden", false), photoSource = c.string("photoSource"), sourceMarked = c.bool("sourceMarked", false),
            )
        }
    }
}

/** One change in the log (site-edits.ts `recentChanges`). */
data class WebsiteEditRecent(val key: String, val name: String, val what: List<String>, val by: String, val at: String) {
    val id: String get() = "$key|$at"

    companion object : Decodable<WebsiteEditRecent> {
        override fun fromMap(m: Map<String, Any?>): WebsiteEditRecent {
            val c = Container(m)
            return WebsiteEditRecent(c.string("key", ""), c.string("name", ""), c.strings("what"), c.string("by", ""), c.string("at", ""))
        }
    }
}

data class WebsiteEditsAnswer(val site: String, val pieces: List<WebsiteEditPiece>, val recent: List<WebsiteEditRecent>) {
    companion object : Decodable<WebsiteEditsAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteEditsAnswer {
            val c = Container(m)
            return WebsiteEditsAnswer(c.string("site", ""), c.list("pieces", WebsiteEditPiece).filter { it.id.isNotEmpty() }, c.list("recent", WebsiteEditRecent))
        }
    }
}

/** GET ?id=: one piece, fresh, and the original photograph's address when the photo was re-made here. */
data class WebsiteEditOne(
    val piece: WebsiteEditPiece?,
    val original: String?,
    /** What the AI did to the photo last time (the kept design's `ai`), to say it is not carried over. */
    val lastAI: List<String>,
) {
    companion object : Decodable<WebsiteEditOne> {
        override fun fromMap(m: Map<String, Any?>): WebsiteEditOne {
            val c = Container(m)
            val design = c.obj("design") { (it as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } }
            return WebsiteEditOne(c.obj("piece", WebsiteEditPiece), c.string("original"), design?.strings("ai") ?: emptyList())
        }
    }
}

/** POST's answer: the piece as it now is, and the ERP's note when nothing had changed. */
data class WebsiteEditSaved(val piece: WebsiteEditPiece?, val note: String?) {
    companion object : Decodable<WebsiteEditSaved> {
        override fun fromMap(m: Map<String, Any?>): WebsiteEditSaved {
            val c = Container(m)
            return WebsiteEditSaved(c.obj("piece", WebsiteEditPiece), c.string("note"))
        }
    }
}

// MARK: The house's website (/api/app/website, /api/website/featured)

/** /api/app/website: the house's website and which of its screens it has (lib/store-config.ts). */
data class WebsiteSettings(
    val site: String,
    val siteName: String,
    /** A set of the day on the home page (taheri.shop; the Mina catalogue has none). */
    val featured: Boolean,
    val weights: Boolean,
    val edit: Boolean,
    val investments: Boolean,
) {
    companion object : Decodable<WebsiteSettings> {
        override fun fromMap(m: Map<String, Any?>): WebsiteSettings {
            val c = Container(m)
            return WebsiteSettings(
                c.string("site", ""), c.string("siteName", "the website"), c.bool("featured", false),
                c.bool("weights", false), c.bool("edit", false), c.bool("investments", false),
            )
        }
    }
}

/** The set of the day (`app_settings/website_featured`, /api/website/featured). */
data class WebsiteFeatured(val key: String, val note: String, val collection: String, val file: String, val thumb: String) {
    companion object : Decodable<WebsiteFeatured> {
        override fun fromMap(m: Map<String, Any?>): WebsiteFeatured {
            val c = Container(m)
            return WebsiteFeatured(c.string("key", ""), c.string("note", ""), c.string("collection", ""), c.string("file", ""), c.string("thumb", ""))
        }
    }
}

/** `{ featured }`, null when none is chosen (an empty key is none). */
data class WebsiteFeaturedAnswer(val featured: WebsiteFeatured?) {
    companion object : Decodable<WebsiteFeaturedAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteFeaturedAnswer {
            val f = Container(m).obj("featured", WebsiteFeatured)
            return WebsiteFeaturedAnswer(if (f == null || f.key.isEmpty()) null else f)
        }
    }
}

// MARK: Investments (/api/investments, /schedule, /status)

/** A day's gold post as the routine filed it (lib/investments.ts `InvestmentPost`). */
data class WebsiteGoldPost(
    val id: String,
    val date: String,
    val post: String,
    val teaser: String,
    /** "square", "story". */
    val cards: List<String>,
    val receivedAt: String,
    val source: String,
    val editedAt: String?,
    /** Part (group, channel, teaser, instagram) → when it went. */
    val sent: Map<String, Went>,
    val hold: Boolean,
    val approvedAt: String?,
) {
    data class Went(val at: String, val by: String)

    /** The first line of the post, without WhatsApp's bold and italic marks. */
    val headline: String
        get() {
            val line = post.split('\n').firstOrNull { it.trim().isNotEmpty() } ?: ""
            return line.replace("*", "").replace("_", "")
        }

    companion object : Decodable<WebsiteGoldPost> {
        override fun fromMap(m: Map<String, Any?>): WebsiteGoldPost {
            val c = Container(m)
            val date = c.string("date", "")
            val sent = LinkedHashMap<String, Went>()
            (m["sent"] as? Map<*, *>)?.forEach { (part, v) ->
                val w = (v as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } ?: return@forEach
                val at = w.string("at", "")
                if (at.isNotEmpty()) sent[part.toString()] = Went(at, w.string("by", ""))
            }
            val approved = c.obj("approved") { (it as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } }
            return WebsiteGoldPost(
                id = c.string("id", date), date = date, post = c.string("post", ""), teaser = c.string("teaser", ""), cards = c.strings("cards"),
                receivedAt = c.string("receivedAt", ""), source = c.string("source", ""), editedAt = c.string("editedAt"), sent = sent,
                hold = c.bool("hold", false), approvedAt = approved?.string("at", "")?.ifEmpty { null },
            )
        }
    }
}

data class WebsiteGoldAnswer(val posts: List<WebsiteGoldPost>, val today: String) {
    companion object : Decodable<WebsiteGoldAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteGoldAnswer {
            val c = Container(m)
            return WebsiteGoldAnswer(c.list("posts", WebsiteGoldPost).filter { it.id.isNotEmpty() }, c.string("today", ""))
        }
    }
}

/** The owner's schedule (lib/investments-schedule.ts `Schedule`), as a draft the screen edits and sends back whole. */
data class WebsiteGoldSchedule(
    val enabled: Boolean,
    val days: List<Int>,
    /** "auto" or "approve". */
    val mode: String,
    val targets: Map<String, Plan>,
    val lateUntil: String,
    val updatedBy: String?,
    val lastTick: String?,
) {
    data class Plan(val on: Boolean, /** "HH:MM" Karachi, or "arrival". */ val at: String)

    fun plan(t: String): Plan = targets[t] ?: defaults[t] ?: Plan(false, "11:30")

    fun withPlan(t: String, p: Plan): WebsiteGoldSchedule = copy(targets = targets + (t to p))

    /** What PUT /api/investments/schedule takes (the server normalises it and keeps the scheduler's heartbeat). */
    val body: Map<String, Any?>
        get() = mapOf(
            "enabled" to enabled, "days" to days.sorted(), "mode" to mode,
            "targets" to targets.mapValues { (_, p) -> mapOf("on" to p.on, "at" to p.at) }, "lateUntil" to lateUntil,
        )

    /** The parts the owner chose, without the bookkeeping, to tell a changed draft from the saved one. */
    fun sameChoices(other: WebsiteGoldSchedule): Boolean =
        enabled == other.enabled && days.sorted() == other.days.sorted() && mode == other.mode && targets == other.targets && lateUntil == other.lateUntil

    companion object : Decodable<WebsiteGoldSchedule> {
        /** The schedule's defaults (DEFAULT_SCHEDULE), for a part the answer leaves out. */
        val defaults: Map<String, Plan> = mapOf(
            "group" to Plan(true, "11:30"), "channel" to Plan(false, "11:30"), "teaser" to Plan(true, "12:00"), "instagram" to Plan(false, "13:00"),
        )

        override fun fromMap(m: Map<String, Any?>): WebsiteGoldSchedule {
            val c = Container(m)
            val raw = m["targets"] as? Map<*, *>
            val plans = LinkedHashMap<String, Plan>()
            for ((t, d) in defaults) {
                val given = (raw?.get(t) as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) }
                plans[t] = Plan(given?.bool("on") ?: d.on, given?.string("at") ?: d.at)
            }
            return WebsiteGoldSchedule(
                enabled = c.bool("enabled", false), days = ints(c, "days").filter { it in 0..6 },
                mode = if (c.string("mode", "auto") == "approve") "approve" else "auto", targets = plans,
                lateUntil = c.string("lateUntil", "20:00"), updatedBy = c.string("updatedBy"), lastTick = c.string("lastTick"),
            )
        }
    }
}

data class WebsiteGoldScheduleAnswer(val schedule: WebsiteGoldSchedule?) {
    companion object : Decodable<WebsiteGoldScheduleAnswer> {
        override fun fromMap(m: Map<String, Any?>): WebsiteGoldScheduleAnswer = WebsiteGoldScheduleAnswer(Container(m).obj("schedule", WebsiteGoldSchedule))
    }
}

/**
 * /api/investments/status: the parts this shop can send, in their order and words, and what the schedule will do with
 * each of today's (statusOf + the page's line, worked out on the server).
 */
data class WebsiteGoldStatus(
    val today: String,
    val enabled: Boolean,
    val mode: String,
    val lastTick: String?,
    val targets: List<Target>,
    val dayId: String?,
    val parts: Map<String, Part>,
) {
    data class Target(val id: String, val label: String, val to: String)

    /** [tone] is "ok", "warn" or "muted". */
    data class Part(val kind: String, val line: String?, val tone: String)

    companion object : Decodable<WebsiteGoldStatus> {
        private fun part(v: Any?): Part? {
            val c = (v as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } ?: return null
            val line = c.obj("line") { (it as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) } }
            val text = line?.string("text", "") ?: ""
            return Part(c.string("kind", ""), text.ifEmpty { null }, line?.string("tone", "muted") ?: "muted")
        }

        override fun fromMap(m: Map<String, Any?>): WebsiteGoldStatus {
            val c = Container(m)
            val targets = c.list("targets") { v ->
                (v as? Map<*, *>)?.let { x -> Container(x.entries.associate { e -> e.key.toString() to e.value }) }
                    ?.let { t -> Target(t.string("id", ""), t.string("label", ""), t.string("to", "")) }
            }.filter { it.id.isNotEmpty() }
            val day = m["day"] as? Map<*, *>
            val parts = LinkedHashMap<String, Part>()
            (day?.get("parts") as? Map<*, *>)?.forEach { (t, v) -> part(v)?.let { parts[t.toString()] = it } }
            return WebsiteGoldStatus(
                c.string("today", ""), c.bool("enabled", false), c.string("mode", "auto"), c.string("lastTick"), targets,
                day?.let { Container(it.entries.associate { e -> e.key.toString() to e.value }).string("id", "") }, parts,
            )
        }
    }
}
