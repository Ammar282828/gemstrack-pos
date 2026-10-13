package erp.app.screens.marketing

import erp.core.Container
import erp.core.Decodable

// The Posts hub's answers, read as leniently as the web reads them (src/app/posts/page.tsx): a missing or odd field
// gives a default, never an error that would empty the hub (CONVENTIONS.md rule 3).

/** A piece on the house's own website (src/lib/website/site-pieces.ts `SitePiece`), with what the phone shows. */
data class PostPiece(
    val id: String,
    val name: String,
    /** The piece's page on the site. */
    val url: String,
    val image: String,
    val thumb: String,
    val collection: String,
    val weightGrams: Double?,
    val facts: List<String>,
    val about: String,
    /** When it went on the site, epoch milliseconds, if the site says. */
    val added: Double?,
    val newArrival: Boolean,
    val hidden: Boolean,
) {
    companion object : Decodable<PostPiece> {
        override fun fromMap(m: Map<String, Any?>): PostPiece {
            val c = Container(m)
            val image = c.string("image", "")
            val small = c.string("thumb", "")
            return PostPiece(
                id = c.string("id", ""), name = c.string("name", ""), url = c.string("url", ""), image = image,
                thumb = small.ifEmpty { image }, collection = c.string("collection", ""), weightGrams = c.double("weightGrams"),
                facts = c.strings("facts"), about = c.string("about", ""), added = c.double("added"),
                newArrival = c.bool("newArrival", false), hidden = c.bool("hidden", false),
            )
        }
    }
}

/** /api/website/site-pieces: the site, its pieces, and when each last went to WhatsApp. */
data class PostPiecesAnswer(val site: String, val pieces: List<PostPiece>, val posted: Map<String, String>) {
    companion object : Decodable<PostPiecesAnswer> {
        override fun fromMap(m: Map<String, Any?>): PostPiecesAnswer {
            val c = Container(m)
            return PostPiecesAnswer(c.string("site", ""), c.list("pieces", PostPiece).filter { it.id.isNotEmpty() }, c.stringMap("posted"))
        }
    }
}

/** One thing that went out (src/lib/social/sent-log.ts `Sent`): a piece and the places it went. */
data class PostSent(
    val key: String,
    val at: String,
    val title: String,
    val sitePiece: String?,
    /** Log names ("whatsapp-community", "whatsapp-channel", "whatsapp-group:diamonds", "instagram-story"). */
    val destinations: List<String>,
) {
    val id: String get() = "$key|$at"

    companion object : Decodable<PostSent> {
        override fun fromMap(m: Map<String, Any?>): PostSent {
            val c = Container(m)
            return PostSent(c.string("key", ""), c.string("at", ""), c.string("title", ""), c.string("sitePiece"), c.strings("destinations"))
        }
    }
}

data class PostSentAnswer(val sent: List<PostSent>) {
    companion object : Decodable<PostSentAnswer> {
        override fun fromMap(m: Map<String, Any?>): PostSentAnswer = PostSentAnswer(Container(m).list("sent", PostSent).filter { it.at.isNotEmpty() })
    }
}

/** A piece waiting to go, scheduled, or lately sent (src/lib/social/queue.ts `QueueItemView`). */
data class PostQueueEntry(
    val id: String,
    /** draft, held, scheduled, sending, sent, failed. */
    val status: String,
    val dueAt: String?,
    val createdAt: String,
    val sentAt: String?,
    val headline: String,
    /** A small JPEG as a data address. */
    val thumb: String?,
    val toWebsite: Boolean,
    val toInstagram: Boolean,
    /** WhatsApp destination keys. */
    val whatsapp: List<String>,
    /** How many single sends it makes, and how many have gone. */
    val units: Int,
    val done: Int,
    val lastError: String?,
    /** What the send sheet shows before anything goes: the caption, the website's collection and photo names, how many photos each place gets,
     *  and each send ("site-0", "featured", "instagram", "wa:<key>:<n>") with what has gone and what failed (queue.ts `units`, `done`, `errors`). */
    val caption: String,
    val websiteCollection: String,
    val websiteNames: List<String>,
    val websiteFeatured: Boolean,
    val sitePhotos: Int,
    val waPhotos: Int,
    val unitKeys: List<String>,
    val doneKeys: Set<String>,
    val unitErrors: Map<String, String>,
) {
    companion object : Decodable<PostQueueEntry> {
        override fun fromMap(m: Map<String, Any?>): PostQueueEntry {
            val c = Container(m)
            val unitKeys = c.strings("units")
            val finished = (m["done"] as? Map<*, *>)?.keys?.map { it.toString() } ?: emptyList()
            val problems = (m["errors"] as? Map<*, *>).orEmpty()
            val said = LinkedHashMap<String, String>()
            for ((unit, f) in problems) {
                val message = ((f as? Map<*, *>)?.get("message") as? String) ?: continue
                if (message.isNotEmpty()) said[unit.toString()] = message
            }
            val site = (m["website"] as? Map<*, *>)?.let { w ->
                @Suppress("UNCHECKED_CAST")
                Container(w as Map<String, Any?>)
            }
            @Suppress("UNCHECKED_CAST")
            val counts = (m["counts"] as? Map<*, *>)?.let { Container(it as Map<String, Any?>) }
            return PostQueueEntry(
                id = c.string("id", ""), status = c.string("status", ""), dueAt = c.string("dueAt"), createdAt = c.string("createdAt", ""),
                sentAt = c.string("sentAt"), headline = c.string("headline", ""), thumb = c.string("thumb"),
                toWebsite = m["website"] != null, toInstagram = c.bool("instagram", false), whatsapp = c.strings("whatsapp"),
                units = unitKeys.size, done = finished.size, lastError = said.values.firstOrNull(),
                caption = c.string("caption", ""), websiteCollection = site?.string("collection", "") ?: "",
                websiteNames = site?.strings("names") ?: emptyList(), websiteFeatured = site?.bool("featured", false) ?: false,
                sitePhotos = counts?.double("site", 0.0)?.toInt() ?: 0, waPhotos = counts?.double("wa", 0.0)?.toInt() ?: 0,
                unitKeys = unitKeys, doneKeys = finished.toSet(), unitErrors = said,
            )
        }
    }
}

data class PostQueueAnswer(val items: List<PostQueueEntry>) {
    companion object : Decodable<PostQueueAnswer> {
        override fun fromMap(m: Map<String, Any?>): PostQueueAnswer = PostQueueAnswer(Container(m).list("items", PostQueueEntry).filter { it.id.isNotEmpty() })
    }
}

/** One check of the posting lines (src/lib/social/health.ts `Check`). */
data class PostCheck(val id: String, val group: String, val label: String, /** ok, warn, fail, off. */ val status: String, val detail: String, val fix: String?) {
    companion object : Decodable<PostCheck> {
        override fun fromMap(m: Map<String, Any?>): PostCheck {
            val c = Container(m)
            return PostCheck(c.string("id", ""), c.string("group", ""), c.string("label", ""), c.string("status", ""), c.string("detail", ""), c.string("fix"))
        }
    }
}

data class PostChecksAnswer(val checks: List<PostCheck>) {
    companion object : Decodable<PostChecksAnswer> {
        override fun fromMap(m: Map<String, Any?>): PostChecksAnswer = PostChecksAnswer(Container(m).list("checks", PostCheck))
    }
}

/** Today's gold post, as the routine filed it (Taheri's Investments; src/lib/investments.ts). */
data class PostGold(val date: String, /** Part (group, channel, teaser, instagram) → when it went. */ val sent: Map<String, String>) {
    companion object : Decodable<PostGold> {
        override fun fromMap(m: Map<String, Any?>): PostGold {
            val out = LinkedHashMap<String, String>()
            for ((part, went) in (m["sent"] as? Map<*, *>).orEmpty()) {
                val at = (went as? Map<*, *>)?.get("at") as? String ?: continue
                out[part.toString()] = at
            }
            return PostGold(Container(m).string("date", ""), out)
        }
    }
}

data class PostGoldAnswer(val posts: List<PostGold>, val today: String) {
    companion object : Decodable<PostGoldAnswer> {
        override fun fromMap(m: Map<String, Any?>): PostGoldAnswer {
            val c = Container(m)
            return PostGoldAnswer(c.list("posts", PostGold), c.string("today", ""))
        }
    }
}

/** /api/investments/schedule: which parts of the gold post this shop can send at all. */
data class PostGoldParts(val destinations: Map<String, Boolean>) {
    companion object : Decodable<PostGoldParts> {
        override fun fromMap(m: Map<String, Any?>): PostGoldParts {
            val out = LinkedHashMap<String, Boolean>()
            for ((part, on) in (m["destinations"] as? Map<*, *>).orEmpty()) out[part.toString()] = (on as? Boolean) ?: false
            return PostGoldParts(out)
        }
    }
}

/** /api/website/post: where a post goes, to name the places in the day's list. */
data class PostAudience(val communityName: String? = null, val groups: List<Place> = emptyList()) {
    data class Place(val key: String, val label: String, val name: String) {
        companion object : Decodable<Place> {
            override fun fromMap(m: Map<String, Any?>): Place {
                val c = Container(m)
                return Place(c.string("key", ""), c.string("label", ""), c.string("name", ""))
            }
        }
    }

    companion object : Decodable<PostAudience> {
        override fun fromMap(m: Map<String, Any?>): PostAudience {
            val c = Container(m)
            val community = (m["community"] as? Map<*, *>)?.get("name") as? String
            return PostAudience(community, c.list("groups", Place))
        }
    }
}
