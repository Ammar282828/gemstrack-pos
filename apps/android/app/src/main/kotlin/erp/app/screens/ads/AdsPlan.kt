package erp.app.screens.ads

import erp.app.nav.ScreenRoute
import erp.app.ui.PaymentText
import erp.core.Container
import erp.core.Decodable
import erp.core.swiftRounded
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

// New ad's and the ad set designer's shapes (src/lib/ads/targeting.ts AudienceDraft, plan.ts AdPlan), read
// leniently from the routes and written back as the JSON the routes take (AdsPlanModels.swift). Nothing here
// decides whether an ad can be made or what it costs: that is the server's (/api/ads/plan, then the create routes,
// which check again).

/** A place an ad shows in (targeting.ts GeoPick / PinPick): a country, region, city, area, postcode or a pin. */
data class AdsPlace(
    val type: String,
    val key: String,
    val name: String,
    /** "Sindh, Pakistan": tells two Hyderabads apart. */
    val detail: String? = null,
    /** Cities (and places): people within this many km of it too. */
    val radiusKm: Double? = null,
    val lat: Double? = null,
    val lng: Double? = null,
) {
    val id: String get() = if (type == "pin") "pin:${lat ?: 0.0},${lng ?: 0.0}" else "$type:$key"

    val json: Map<String, Any?>
        get() {
            val o = LinkedHashMap<String, Any?>()
            o["type"] = type
            o["name"] = name
            if (type == "pin") {
                o["lat"] = lat ?: 0.0
                o["lng"] = lng ?: 0.0
                o["radiusKm"] = radiusKm ?: 10.0
            } else {
                o["key"] = key
                if (!detail.isNullOrEmpty()) o["detail"] = detail
                if (radiusKm != null && radiusKm > 0) o["radiusKm"] = radiusKm
            }
            return o
        }

    /** "Karachi +25 km" (targeting.ts placeLabel). */
    val label: String
        get() {
            if (type == "pin") return "$name +${pinKm(radiusKm)} km"
            if (radiusKm != null && radiusKm > 0 && (type == "city" || type == "place")) return "$name +${swiftRounded(radiusKm).toInt()} km"
            return name
        }

    companion object : Decodable<AdsPlace> {
        val pakistan = AdsPlace("country", "PK", "Pakistan")

        /** Meta's limit for a dropped pin: 1–80 km (targeting.ts pinRadius). */
        private fun pinKm(km: Double?): Int = minOf(80, maxOf(1, swiftRounded(km ?: 10.0).toInt()))

        override fun fromMap(m: Map<String, Any?>): AdsPlace {
            val c = Container(m)
            return AdsPlace(
                c.string("type", "country"), c.string("key", ""), c.string("name", ""), c.string("detail"),
                c.double("radiusKm"), c.double("lat"), c.double("lng"),
            )
        }
    }
}

/** An interest or one of the house's audiences, by Meta's id. */
data class AdsNamed(val id: String, val name: String) {
    val json: Map<String, Any?> get() = mapOf("id" to id, "name" to name)

    companion object : Decodable<AdsNamed> {
        override fun fromMap(m: Map<String, Any?>): AdsNamed {
            val c = Container(m)
            return AdsNamed(c.string("id", ""), c.string("name", c.string("id", "")))
        }
    }
}

/** Who an ad is shown to (targeting.ts AudienceDraft); the defaults are defaultDraft()'s. */
data class AdsAudience(
    val places: List<AdsPlace> = listOf(AdsPlace.pakistan),
    val ageMin: Int = 18,
    val ageMax: Int = 65,
    /** "all", "women" or "men". */
    val gender: String = "all",
    val interests: List<AdsNamed> = emptyList(),
    val include: List<AdsNamed> = emptyList(),
    val exclude: List<AdsNamed> = emptyList(),
    /** Advantage+ audience: Meta may go beyond ages, gender and interests; places and "leave out" stay firm. */
    val advantage: Boolean = true,
    /** "instagram", "instagram_facebook" or "auto". */
    val placements: String = "instagram",
    val igPositions: List<String> = listOf("stream", "story", "reels"),
) {
    val json: Map<String, Any?>
        get() {
            val o = LinkedHashMap<String, Any?>()
            o["places"] = places.map { it.json }
            o["ageMin"] = ageMin
            o["ageMax"] = ageMax
            o["gender"] = gender
            o["interests"] = interests.map { it.json }
            o["include"] = include.map { it.json }
            o["exclude"] = exclude.map { it.json }
            o["advantage"] = advantage
            o["placements"] = placements
            o["igPositions"] = igPositions
            return o
        }

    /** One line, as the web writes it under "Who sees it" (targeting.ts describeAudience). Words only. */
    val words: String
        get() {
            val parts = ArrayList<String>()
            parts.add(if (places.isEmpty()) "Pakistan" else places.joinToString(", ") { it.label })
            parts.add("$ageMin–${if (ageMax >= 65) "65+" else ageMax.toString()}")
            parts.add(if (gender == "all") "everyone" else gender)
            if (interests.isNotEmpty()) parts.add(interests.joinToString(", ") { it.name })
            if (include.isNotEmpty()) parts.add("in " + include.joinToString(", ") { it.name })
            if (exclude.isNotEmpty()) parts.add("not " + exclude.joinToString(", ") { it.name })
            if (advantage) parts.add("Advantage+")
            parts.add(if (placements == "auto") "all placements" else (if (placements == "instagram") "Instagram only" else "Instagram and Facebook"))
            return parts.joinToString(" · ")
        }

    companion object : Decodable<AdsAudience> {
        override fun fromMap(m: Map<String, Any?>): AdsAudience {
            val c = Container(m)
            // An empty list stays empty (New ad then asks for a place); a missing one is the default's Pakistan.
            val places = if (m.containsKey("places")) c.list("places", AdsPlace) else listOf(AdsPlace.pakistan)
            val ageMin = minOf(65, maxOf(18, c.int("ageMin") ?: 18))
            val ageMax = minOf(65, maxOf(ageMin, c.int("ageMax") ?: 65))
            val g = c.string("gender", "all")
            val p = c.string("placements", "instagram")
            val ig = c.strings("igPositions")
            return AdsAudience(
                places = places, ageMin = ageMin, ageMax = ageMax,
                gender = if (g in listOf("all", "women", "men")) g else "all",
                interests = c.list("interests", AdsNamed).filter { it.id.isNotEmpty() },
                include = c.list("include", AdsNamed).filter { it.id.isNotEmpty() },
                exclude = c.list("exclude", AdsNamed).filter { it.id.isNotEmpty() },
                advantage = c.bool("advantage", true),
                placements = if (p in listOf("instagram", "instagram_facebook", "auto")) p else "instagram",
                igPositions = ig.ifEmpty { listOf("stream", "story", "reels") },
            )
        }
    }
}

/** A budget and its dates (plan.ts AdPlan.budget). ISO strings, as the routes take them. */
data class AdsBudget(
    /** "daily" or "total". */
    val kind: String = "daily",
    val amount: Double = 1000.0,
    val start: String? = null,
    val end: String? = null,
) {
    val json: Map<String, Any?> get() = linkedMapOf("kind" to kind, "amount" to amount, "start" to start, "end" to end)
}

// MARK: What New ad offers (GET /api/ads/plan)

/** A goal, in the web's words (plan.ts GOALS through phone-plan.ts phoneGoals). */
data class AdsGoal(
    val key: String,
    val label: String,
    val hint: String,
    val objective: String,
    val optimization: String,
    val postOnly: Boolean,
    val photosOnly: Boolean,
    /** The button opens a page on the house's site. */
    val toSite: Boolean,
    /** New ad offers it in this house. */
    val newAd: Boolean,
) {
    companion object : Decodable<AdsGoal> {
        override fun fromMap(m: Map<String, Any?>): AdsGoal {
            val c = Container(m)
            return AdsGoal(
                c.string("key", ""), c.string("label", ""), c.string("hint", ""), c.string("objective", ""), c.string("optimization", ""),
                c.bool("postOnly", false), c.bool("photosOnly", false), c.bool("toSite", false), c.bool("newAd", true),
            )
        }
    }
}

/** A key and its words: a button, an Instagram placement, a segment, a kind. */
data class AdsChoice(val key: String, val label: String) {
    companion object : Decodable<AdsChoice> {
        /** Where on Instagram, should the server's list not have come (targeting.ts IG_POSITIONS). */
        val instagramPlaces = listOf(
            AdsChoice("stream", "Feed"), AdsChoice("story", "Stories"), AdsChoice("reels", "Reels"), AdsChoice("profile_feed", "Profile feed"),
        )

        override fun fromMap(m: Map<String, Any?>): AdsChoice {
            val c = Container(m)
            return AdsChoice(c.string("key", ""), c.string("label", ""))
        }
    }
}

/** A day the house keeps free of product ads (Taheri's Bohra calendar). */
data class AdsQuietDay(
    /** "2026-06-17", a Karachi day. */
    val date: String,
    val hijri: String,
    val name: String,
    /** One of the days just before it. */
    val near: Boolean,
) {
    companion object : Decodable<AdsQuietDay> {
        override fun fromMap(m: Map<String, Any?>): AdsQuietDay {
            val c = Container(m)
            return AdsQuietDay(c.string("date", ""), c.string("hijri", ""), c.string("name", ""), c.bool("near", false))
        }
    }
}

/** GET /api/ads/plan. */
data class AdsNewAdLists(
    val goals: List<AdsGoal>,
    val buttons: List<AdsChoice>,
    val igPositions: List<AdsChoice>,
    val website: String,
    val shop: String,
    val waChannel: String,
    /** The house's website pieces can be promoted (STORE_SITE_POSTS and a website). */
    val sitePieces: Boolean,
    val quiet: List<AdsQuietDay>,
) {
    fun goal(key: String): AdsGoal? = goals.firstOrNull { it.key == key }

    companion object : Decodable<AdsNewAdLists> {
        override fun fromMap(m: Map<String, Any?>): AdsNewAdLists {
            val c = Container(m)
            val l = Container(m.obj("links") ?: emptyMap())
            return AdsNewAdLists(
                goals = c.list("goals", AdsGoal).filter { it.key.isNotEmpty() },
                buttons = c.list("buttons", AdsChoice), igPositions = c.list("igPositions", AdsChoice),
                website = l.string("website", ""), shop = l.string("shop", ""), waChannel = l.string("waChannel", ""),
                sitePieces = c.bool("sitePieces", false), quiet = c.list("quiet", AdsQuietDay),
            )
        }
    }
}

/** POST /api/ads/plan { plan }: what stops it, planSummary's lines, the name it will have, and who sees it. */
data class AdsPlanCheck(val problems: List<String>, val summary: List<String>, val name: String, val audience: String) {
    companion object : Decodable<AdsPlanCheck> {
        override fun fromMap(m: Map<String, Any?>): AdsPlanCheck {
            val c = Container(m)
            return AdsPlanCheck(c.strings("problems"), c.strings("summary"), c.string("name", ""), c.string("audience", ""))
        }
    }
}

/** POST /api/ads/plan { design }. */
data class AdsDesignCheck(val problems: List<String>, val summary: List<String>, val count: Int) {
    companion object : Decodable<AdsDesignCheck> {
        override fun fromMap(m: Map<String, Any?>): AdsDesignCheck {
            val c = Container(m)
            return AdsDesignCheck(c.strings("problems"), c.strings("summary"), c.int("count") ?: 0)
        }
    }
}

// MARK: What to promote

/** An Instagram post or reel (/api/ads/media). */
data class AdsMedia(
    val id: String,
    val caption: String,
    /** IMAGE, VIDEO, REEL, CAROUSEL_ALBUM. */
    val type: String,
    val thumb: String?,
    val permalink: String?,
    /** Meta's word on whether it can be boosted; null when it didn't say. */
    val boostable: Boolean?,
    val why: String?,
) {
    val kindWord: String?
        get() = when (type) {
            "IMAGE" -> null
            "REEL" -> "Reel"
            "CAROUSEL_ALBUM" -> "Carousel"
            else -> "Video"
        }

    companion object : Decodable<AdsMedia> {
        /** The post an ad was made from ("Make one like this"). */
        fun of(id: String, caption: String, thumb: String?, permalink: String?) = AdsMedia(id, caption, "IMAGE", thumb, permalink, true, null)

        override fun fromMap(m: Map<String, Any?>): AdsMedia {
            val c = Container(m)
            return AdsMedia(
                c.string("id", ""), c.string("caption", ""), c.string("type", "IMAGE"), c.string("thumb"), c.string("permalink"),
                c.bool("boostable"), c.string("why"),
            )
        }
    }
}

data class AdsMediaAnswer(val media: List<AdsMedia>, val after: String?) {
    companion object : Decodable<AdsMediaAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsMediaAnswer {
            val c = Container(m)
            return AdsMediaAnswer(c.list("media", AdsMedia).filter { it.id.isNotEmpty() }, c.string("after"))
        }
    }
}

/** A picture already in the ad account's library (/api/ads/library). */
data class AdsLibraryImage(val hash: String, val url: String, val thumb: String, val name: String) {
    companion object : Decodable<AdsLibraryImage> {
        override fun fromMap(m: Map<String, Any?>): AdsLibraryImage {
            val c = Container(m)
            val url = c.string("url", "")
            val small = c.string("thumb", "")
            return AdsLibraryImage(c.string("hash", ""), url, small.ifEmpty { url }, c.string("name", ""))
        }
    }
}

data class AdsLibraryAnswer(val images: List<AdsLibraryImage>, val after: String?) {
    companion object : Decodable<AdsLibraryAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsLibraryAnswer {
            val c = Container(m)
            return AdsLibraryAnswer(c.list("images", AdsLibraryImage).filter { it.hash.isNotEmpty() }, c.string("after"))
        }
    }
}

/** /api/ads/images: the photo in the ad account's library, by its hash. */
data class AdsImageAnswer(val hash: String, val url: String?) {
    companion object : Decodable<AdsImageAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsImageAnswer {
            val c = Container(m)
            return AdsImageAnswer(c.string("hash", ""), c.string("url"))
        }
    }
}

/** A photo of a new ad, as the screen holds it: on its way to Meta, there with its hash, or refused. */
data class AdsPhoto(
    val key: String,
    val hash: String = "",
    /** Meta's copy, once there (the library's, or the template's). */
    val url: String? = null,
    /** A small picture to show for it (the library's or the website's thumbnail), when there is no `preview`. */
    val thumb: String? = null,
    /** What was picked on this phone, shown while it uploads. */
    val preview: androidx.compose.ui.graphics.ImageBitmap? = null,
    /** A carousel card's own headline and link. */
    val headline: String = "",
    val link: String = "",
    val uploading: Boolean = false,
    val error: String? = null,
) {
    val ready: Boolean get() = hash.isNotEmpty() && error == null && !uploading

    val json: Map<String, Any?>
        get() {
            val o = LinkedHashMap<String, Any?>()
            o["hash"] = hash
            o["url"] = url
            if (headline.trim().isNotEmpty()) o["headline"] = headline
            if (link.trim().isNotEmpty()) o["link"] = link
            return o
        }
}

/** Meta's own rendering of an unsaved ad (/api/ads/preview): a facebook.com frame per format. */
data class AdsPreview(val format: String, val src: String) {
    val label: String
        get() = when (format) {
            "INSTAGRAM_STANDARD" -> "Feed"
            "INSTAGRAM_STORY" -> "Story"
            else -> "Reels"
        }

    companion object : Decodable<AdsPreview> {
        override fun fromMap(m: Map<String, Any?>): AdsPreview {
            val c = Container(m)
            return AdsPreview(c.string("format", ""), c.string("src", ""))
        }

        fun list(value: Any?): List<AdsPreview> =
            Container(mapOf("previews" to ((value as? Map<*, *>)?.get("previews")))).list("previews", AdsPreview).filter { it.src.isNotEmpty() }
    }
}

// MARK: Make one like this (/api/ads/template)

data class AdsTemplatePhoto(val hash: String, val url: String?, val headline: String, val link: String) {
    companion object : Decodable<AdsTemplatePhoto> {
        override fun fromMap(m: Map<String, Any?>): AdsTemplatePhoto {
            val c = Container(m)
            return AdsTemplatePhoto(c.string("hash", ""), c.string("url"), c.string("headline", ""), c.string("link", ""))
        }
    }
}

data class AdsTemplate(
    val goal: String,
    /** "post" or "photos". */
    val kind: String,
    val mediaId: String,
    val permalink: String?,
    val thumb: String?,
    val caption: String,
    val photos: List<AdsTemplatePhoto>,
    val vertical: AdsTemplatePhoto?,
    val text: String,
    val headline: String,
    val link: String,
    val button: String,
    val audience: AdsAudience,
    val budgetKind: String,
    val budgetAmount: Double,
    val name: String,
) {
    companion object : Decodable<AdsTemplate> {
        /** The answer is `{ template: { … } }`. */
        override fun from(value: Any?): AdsTemplate? {
            val outer = (value as? Map<*, *>)?.get("template") ?: return null
            return super.from(outer)
        }

        override fun fromMap(m: Map<String, Any?>): AdsTemplate {
            val c = Container(m)
            val sm = m.obj("source")
            val s = Container(sm ?: emptyMap())
            val b = Container(m.obj("budget") ?: emptyMap())
            return AdsTemplate(
                goal = c.string("goal", "whatsapp"),
                kind = if (sm != null) s.string("kind", "photos") else "photos",
                mediaId = s.string("mediaId", ""), permalink = s.string("permalink"), thumb = s.string("thumb"), caption = s.string("caption", ""),
                photos = s.list("photos", AdsTemplatePhoto).filter { it.hash.isNotEmpty() },
                vertical = s.obj("vertical", AdsTemplatePhoto)?.takeIf { it.hash.isNotEmpty() },
                text = c.string("text", ""), headline = c.string("headline", ""), link = c.string("link", ""), button = c.string("button", "SHOP_NOW"),
                audience = c.obj("audience", AdsAudience) ?: AdsAudience(),
                budgetKind = b.string("kind", "daily"), budgetAmount = b.double("amount", 0.0), name = c.string("name", ""),
            )
        }
    }
}

// MARK: Who sees it

/** An interest Meta can target, and about how many people it covers. */
data class AdsInterestHit(val id: String, val name: String, val size: Double?, val path: String?) {
    companion object : Decodable<AdsInterestHit> {
        override fun fromMap(m: Map<String, Any?>): AdsInterestHit {
            val c = Container(m)
            val range = (m["size"] as? List<*>).orEmpty().mapNotNull { Container(mapOf("v" to it)).double("v") }
            return AdsInterestHit(c.string("id", ""), c.string("name", ""), if (range.size == 2) range[1] else null, c.string("path"))
        }
    }
}

/** Meta's estimate of the audience (/api/ads/estimate). */
data class AdsEstimate(val lower: Double?, val upper: Double?) {
    companion object : Decodable<AdsEstimate> {
        override fun fromMap(m: Map<String, Any?>): AdsEstimate {
            val c = Container(m)
            return AdsEstimate(c.double("lower"), c.double("upper"))
        }
    }
}

// MARK: Made

/** /api/ads/create. */
data class AdsMade(val adId: String, val campaignId: String, val live: Boolean, val warnings: List<String>) {
    companion object : Decodable<AdsMade> {
        override fun fromMap(m: Map<String, Any?>): AdsMade {
            val c = Container(m)
            return AdsMade(c.string("adId", ""), c.string("campaignId", ""), c.bool("live", false), c.strings("warnings"))
        }
    }
}

/** /api/ads/adsets POST. */
data class AdsDesignMade(val campaignId: String, val adsets: List<Made>, val live: Boolean, val warnings: List<String>) {
    data class Made(val id: String, val name: String, val ads: List<String>) {
        companion object : Decodable<Made> {
            override fun fromMap(m: Map<String, Any?>): Made {
                val c = Container(m)
                return Made(c.string("id", ""), c.string("name", ""), c.strings("ads"))
            }
        }
    }

    companion object : Decodable<AdsDesignMade> {
        override fun fromMap(m: Map<String, Any?>): AdsDesignMade {
            val c = Container(m)
            return AdsDesignMade(c.string("campaignId", ""), c.list("adsets", Made), c.bool("live", false), c.strings("warnings"))
        }
    }
}

/** GET /api/ads/adsets: the campaign an ad set would join, or an ad set to start from. */
data class AdsAdsetsInfo(
    val campaign: Campaign?,
    val draft: Draft?,
    val ads: List<String>,
    val currency: String,
    val minDaily: Double?,
    val pixelId: String?,
) {
    data class Campaign(
        val id: String,
        val name: String,
        val objective: String,
        /** The campaign holds the budget, so its ad sets carry none. */
        val budgeted: Boolean,
    ) {
        companion object : Decodable<Campaign> {
            override fun fromMap(m: Map<String, Any?>): Campaign {
                val c = Container(m)
                return Campaign(c.string("id", ""), c.string("name", ""), c.string("objective", ""), c.bool("budgeted", false))
            }
        }
    }

    data class Draft(val name: String, val goal: String, val audience: AdsAudience, val budget: AdsBudget) {
        companion object : Decodable<Draft> {
            override fun fromMap(m: Map<String, Any?>): Draft {
                val c = Container(m)
                var b = AdsBudget()
                m.obj("budget")?.let { bm ->
                    val n = Container(bm)
                    b = AdsBudget(
                        kind = if (n.string("kind", "daily") == "total") "total" else "daily",
                        amount = n.double("amount", 0.0), start = n.string("start"), end = n.string("end"),
                    )
                }
                return Draft(c.string("name", "Ad set"), c.string("goal", "whatsapp"), c.obj("audience", AdsAudience) ?: AdsAudience(), b)
            }
        }
    }

    companion object : Decodable<AdsAdsetsInfo> {
        override fun fromMap(m: Map<String, Any?>): AdsAdsetsInfo {
            val c = Container(m)
            return AdsAdsetsInfo(
                campaign = c.obj("campaign", Campaign)?.takeIf { it.id.isNotEmpty() }, draft = c.obj("draft", Draft),
                ads = c.strings("ads"), currency = c.string("currency", "PKR"), minDaily = c.double("minDaily"), pixelId = c.string("pixelId"),
            )
        }
    }
}

// MARK: Words and small helpers (AdsNewAdParts.swift, AdsWorkKit.swift)

/** A query value of an ERP path ("/ads/new?piece=Rings%2FDSC0912.webp" → "Rings/DSC0912.webp"). */
object AdsQuery {
    fun value(name: String, path: String): String? {
        val q = path.substringBefore('#').substringAfter('?', "")
        if (q.isEmpty()) return null
        for (pair in q.split('&')) {
            if (pair.isEmpty()) continue
            if (pair.substringBefore('=') == name) {
                val v = if (pair.contains('=')) ScreenRoute.percentDecode(pair.substringAfter('=')) else ""
                return v.ifEmpty { null }
            }
        }
        return null
    }

    /** `addingPercentEncoding(withAllowedCharacters: .alphanumerics)`: everything but letters and digits is %XX. */
    fun escape(s: String): String {
        val out = StringBuilder()
        for (ch in s) {
            if (ch.isLetterOrDigit()) out.append(ch)
            else for (b in ch.toString().toByteArray(Charsets.UTF_8)) out.append('%').append("%02X".format(b.toInt() and 0xFF))
        }
        return out.toString()
    }
}

/** JSON for the routes: ISO instants without milliseconds, as Swift's `ISO8601Format()`. */
object AdsTime {
    fun iso(i: Instant): String = DateTimeFormatter.ISO_INSTANT.format(i.truncatedTo(ChronoUnit.SECONDS))
}

/** An amount typed in the account's money ("1,500" → 1500): null unless above zero. */
object AdsAmount {
    fun parse(text: String): Double? = PaymentText.amount(text)?.takeIf { it > 0 }

    fun field(v: Double): String = if (v > 0) PaymentText.field(v) else ""
}

object AdsNewAdWords {
    /** A website piece's first words: its name and weight, its facts, and the line the goal asks for. */
    fun pieceText(name: String, weightGrams: Double?, facts: List<String>, goal: String, toSite: Boolean): String {
        var first = name
        if (weightGrams != null && weightGrams > 0) first += " — ${grams(weightGrams)}g"
        val joined = facts.joinToString(" · ")
        val close = if (goal == "whatsapp" || goal == "instagram_dm") "Message us for today’s price." else (if (toSite) "See it on the website." else "")
        val lines = ArrayList<String>()
        lines.add(first)
        if (joined.isNotEmpty()) lines.add(joined)
        lines.add("")
        if (close.isNotEmpty()) lines.add(close)
        return lines.joinToString("\n").trim()
    }

    /** 12.4 → "12.4", 12 → "12", as the web writes a number. */
    fun grams(g: Double): String = if (g == Math.rint(g)) g.toLong().toString() else g.toString()

    private val channel = Regex("""^https://(www\.)?whatsapp\.com/channel/\S+""")
    private val web = Regex("""^https?://\S+\.\S+""")

    /** The shop's WhatsApp channel link, the only place a channel ad can go (plan.ts isChannelLink). */
    fun isChannelLink(s: String): Boolean = channel.containsMatchIn(s.trim())

    /** A web address the button can open (plan.ts planProblems' own test). */
    fun isWebLink(s: String): Boolean = web.containsMatchIn(s.trim())
}
