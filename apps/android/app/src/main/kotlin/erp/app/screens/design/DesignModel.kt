package erp.app.screens.design

import erp.app.screens.marketing.MarketingValue
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// Design's records and rules (DesignModel.swift), ported from the web (docs/features/design.md): src/lib/design/{model,sizes,gate}.ts
// and src/app/design/design-state.ts. A design is a master page and any number of other sizes (origin master | resized | manual);
// a page's layout is the engine's raw JSON (MarketingValue), never decoded into fields, so whatever the web adds to a document
// survives a save from the phone. The sizes are the web's table (lib/ads/studio/templates.ts AD_FORMATS + lib/design/sizes.ts): if
// the web adds a shape, add it to DesignSizes.all too, or the phone will not offer it.

// MARK: Who sees what

/** `designGate('post' | 'ads')` (lib/design/gate.ts): post = owner, staff, marketing; ads = owner, marketing. */
data class DesignAccess(val role: String) {
    val post: Boolean get() = role == "owner" || role == "staff" || role == "marketing"

    /** The library with scores, the Board, the Ad kind: owner and marketing. */
    val ads: Boolean get() = role == "owner" || role == "marketing"
}

enum class DesignSection(val id: String, val title: String) {
    Make("make", "Make"), Photos("photos", "Photos"), Board("board", "Board"), Saved("saved", "Saved");

    companion object {
        /** design-state.ts SECTIONS: the Board is the ad studio's, so owner and marketing only. */
        fun offered(access: DesignAccess): List<DesignSection> = entries.filter { access.ads || it != Board }

        fun of(value: String?, access: DesignAccess): DesignSection = offered(access).firstOrNull { it.id == value } ?: Make
    }
}

/** Photos' parts (design-state.ts PHOTO_PARTS): the website for everyone, the library for owner and marketing. */
enum class DesignPhotoPart(val id: String, val title: String) {
    Site("site", "The website"), Picks("picks", "Best for ads"), Library("library", "Every photo");

    companion object {
        fun offered(access: DesignAccess): List<DesignPhotoPart> = entries.filter { access.ads || it == Site }

        fun of(value: String?, access: DesignAccess): DesignPhotoPart = offered(access).firstOrNull { it.id == value } ?: Site
    }
}

// MARK: Kinds

class DesignKindCard(
    val kind: String,
    val title: String,
    val note: String,
    /** DesignSizes ids the kind starts with. */
    val sizes: List<String>,
    /** Owner and marketing only. */
    val ads: Boolean = false,
)

object DesignKinds {
    /** design-state.ts KIND_CARDS. */
    val cards: List<DesignKindCard> = listOf(
        DesignKindCard("piece", "A piece", "Story and post together", listOf("story", "whatsapp")),
        DesignKindCard("post", "Post", "Square, for the feed", listOf("square")),
        DesignKindCard("story", "Story", "9:16", listOf("story")),
        DesignKindCard("whatsapp", "WhatsApp", "Square, for groups", listOf("whatsapp")),
        DesignKindCard("site", "Website photo", "Square, for the site", listOf("website")),
        DesignKindCard("ad", "Ad", "Meta’s feed sizes", listOf("portrait"), ads = true),
        DesignKindCard("custom", "Any size", "Your own W:H", listOf("square")),
    )

    fun card(kind: String): DesignKindCard = cards.firstOrNull { it.kind == kind } ?: cards[1]

    fun label(kind: String): String =
        mapOf("piece" to "Piece", "ad" to "Ad", "story" to "Story", "post" to "Post", "whatsapp" to "WhatsApp", "site" to "Website", "custom" to "Custom")[kind] ?: "Design"

    fun scope(kind: String): String = if (kind == "ad") "ads" else "shop"

    val valid: Set<String> = setOf("piece", "ad", "story", "post", "whatsapp", "site", "custom")
}

// MARK: Sizes

class DesignSize(
    /** An ad format's key ("portrait"), or "whatsapp" / "website" / "custom". */
    val id: String,
    val label: String,
    /** The ratio as people say it: "4:5", "1.91:1". */
    val ratio: String,
    val w: Double,
    val h: Double,
    /** Width of the exported picture. */
    val px: Double,
    /** The ad format whose frame this is ("custom" for the person's own). */
    val format: String,
    val meta: Boolean,
)

/** A size chosen on the start screen: a table id, or the person's own W:H. */
data class DesignSizeChoice(val id: String, val customW: Int = 4, val customH: Int = 5) {
    val size: DesignSize get() = if (id == "custom") DesignSizes.custom(customW, customH) else (DesignSizes.size(id) ?: DesignSizes.all[1])
}

class DesignSizeGroup(val title: String, val sizes: List<DesignSize>)

object DesignSizes {
    private fun fixed(id: String, label: String, ratio: String, h: Double, px: Double, meta: Boolean = false) =
        DesignSize(id, label, ratio, 1080.0, h, px, id, meta)

    /** Meta's four placements, in the web's order (AD_FORMAT_ORDER). */
    val feed: List<DesignSize> = listOf(
        fixed("portrait", "Feed 4:5", "4:5", 1350.0, 1080.0, meta = true),
        fixed("square", "Feed 1:1", "1:1", 1080.0, 1080.0, meta = true),
        fixed("story", "Stories & reels 9:16", "9:16", 1920.0, 1080.0, meta = true),
        fixed("landscape", "Link 1.91:1", "1.91:1", 565.0, 1200.0, meta = true),
    )

    /** The seven more shapes (MORE_FORMAT_ORDER). */
    val more: List<DesignSize> = listOf(
        fixed("r2x3", "Tall 2:3", "2:3", 1620.0, 1080.0),
        fixed("r3x4", "Portrait 3:4", "3:4", 1440.0, 1080.0),
        fixed("r5x4", "Landscape 5:4", "5:4", 864.0, 1350.0),
        fixed("r4x3", "Landscape 4:3", "4:3", 810.0, 1440.0),
        fixed("r3x2", "Landscape 3:2", "3:2", 720.0, 1620.0),
        fixed("r16x9", "Wide 16:9", "16:9", 608.0, 1920.0),
        fixed("r21x9", "Banner 21:9", "21:9", 463.0, 2520.0),
    )

    /** WhatsApp and the website only ever get 1:1 (the owner, 2026-09-25). */
    val whatsapp = DesignSize("whatsapp", "WhatsApp 1:1", "1:1", 1080.0, 1080.0, 1600.0, "square", false)
    val website = DesignSize("website", "Website 1:1", "1:1", 1080.0, 1080.0, 3000.0, "square", false)

    val all: List<DesignSize> = feed + more + listOf(whatsapp, website)

    fun size(id: String): DesignSize? = all.firstOrNull { it.id == id }

    /** The start screen's groups, as GROUP_LABEL in start.tsx. */
    val groups: List<DesignSizeGroup> = listOf(
        DesignSizeGroup("Feed ads", feed), DesignSizeGroup("WhatsApp", listOf(whatsapp)),
        DesignSizeGroup("Website", listOf(website)), DesignSizeGroup("More shapes", more),
    )

    private tailrec fun gcd(a: Int, b: Int): Int = if (b == 0) a else gcd(b, a % b)

    fun reduce(w: Int, h: Int): Pair<Int, Int> {
        val a = max(1, w)
        val b = max(1, h)
        val g = gcd(a, b)
        return a / g to b / g
    }

    /** A custom W:H as a frame 1080 wide, between 3:1 and 1:2.2 (templates.ts customFormat). */
    fun custom(w: Int, h: Int): DesignSize {
        val (rw, rh) = reduce(min(10_000, max(1, w)), min(10_000, max(1, h)))
        val fh = max(360, min(2400, (1080.0 * rh / rw).roundToInt()))
        val px = if (fh < 1080) min(3240, (1080.0 * 1080.0 / fh).roundToInt()) else 1080
        return DesignSize("custom", "Custom $rw:$rh", "$rw:$rh", 1080.0, fh.toDouble(), px.toDouble(), "custom", false)
    }

    /** The website's own page is the catalogue's photograph (use-design.ts isCataloguePage). */
    fun isCatalogue(label: String): Boolean = label == website.label

    /** Instagram covers a story's top and bottom bands (templates.ts safeZone). */
    fun safeZone(h: Double): Pair<Double, Double> = if (h >= 1800) kotlin.math.floor(h * 0.14 + 0.5) to kotlin.math.floor(h * 0.35 + 0.5) else 0.0 to 0.0
}

// MARK: The design being made

data class DesignPageState(
    val id: String,
    val label: String,
    val format: String,
    val w: Double,
    val h: Double,
    /** master | resized | manual */
    val origin: String,
    /** The page a resized one was made from. */
    val syncedFrom: String?,
    val rev: Int,
    val doc: MarketingValue,
) {
    fun toValue(): MarketingValue = MarketingValue.of(
        mapOf("id" to id, "label" to label, "format" to format, "w" to w, "h" to h, "origin" to origin, "syncedFrom" to syncedFrom, "rev" to rev, "doc" to doc),
    )

    companion object {
        fun from(v: MarketingValue) = DesignPageState(
            id = v.s("id"), label = v.s("label"), format = v.s("format", "square"), w = v.n("w", 1080.0), h = v.n("h", 1080.0),
            origin = v.s("origin", "master"), syncedFrom = v.s("syncedFrom").ifEmpty { null }, rev = v.n("rev").toInt(), doc = v["doc"],
        )
    }
}

/** A page handed to `addPages` (the resize sheet, or one made for a destination). */
class NewDesignPage(
    val id: String?,
    val label: String,
    val format: String,
    val w: Double,
    val h: Double,
    val doc: MarketingValue,
    val origin: String = "resized",
    val syncedFrom: String? = null,
)

/** design-state.ts `DesignWork`. Holds no pixels; the photographs live beside it in the workspace model. */
data class DesignWork(
    /** The saved design's id (`saved:<id>` for a legacy ad opened and not yet saved over); null before the first save. */
    val id: String?,
    val name: String = "",
    val folder: String? = null,
    val kind: String,
    val scope: String,
    /** siteId / productId / assetId */
    val source: Map<String, String> = emptyMap(),
    /** kicker, headline, weight (the specs), details (the button line): shared by every page. */
    val fields: Map<String, String>,
    /** price, wa, ig, adText, adHeadline, goal, link */
    val copy: Map<String, String> = emptyMap(),
    val pages: List<DesignPageState>,
    val master: String,
    val active: String,
    /** Resized pages whose master changed since they were made. */
    val stale: List<String> = emptyList(),
    /** Waiting for its photo to lay the pages out. */
    val fresh: Boolean = false,
    /** Changed since it was last saved to the shop. */
    val dirty: Boolean = false,
    val template: String = "headline",
) {
    val displayName: String
        get() {
            val n = name.trim()
            if (n.isNotEmpty()) return n
            val h = (fields["headline"] ?: "").trim()
            return h.ifEmpty { "Untitled design" }
        }

    fun page(id: String): DesignPageState? = pages.firstOrNull { it.id == id }
    val activePage: DesignPageState get() = page(active) ?: pages[0]
    val masterPage: DesignPageState get() = page(master) ?: pages[0]

    // MARK: Edits (design-state.ts: editing the master marks the pages made from it stale; editing a made page makes it the person's own)

    /** The editor changed a page's document. */
    fun editDoc(pageId: String, doc: MarketingValue): DesignWork {
        val i = pages.indexOfFirst { it.id == pageId }
        if (i < 0 || pages[i].doc == doc) return this
        val isMaster = pageId == master
        var stale2 = stale
        val next = pages.toMutableList()
        next[i] = pages[i].copy(doc = doc, rev = pages[i].rev + 1)
        if (isMaster) {
            for (p in pages) if (p.origin == "resized" && p.syncedFrom == master && p.id !in stale2) stale2 = stale2 + p.id
        } else {
            next[i] = next[i].copy(origin = "manual")
            stale2 = stale2.filter { it != pageId }
        }
        return copy(pages = next, stale = stale2, dirty = true)
    }

    /** A document set from outside the editor (a layout, a re-do, a resize). */
    fun setDoc(pageId: String, doc: MarketingValue, origin: String? = null, syncedFrom: String? = null): DesignWork {
        val i = pages.indexOfFirst { it.id == pageId }
        if (i < 0) return this
        val next = pages.toMutableList()
        var p = pages[i]
        if (origin != null) p = p.copy(origin = origin)
        if (syncedFrom != null) p = p.copy(syncedFrom = syncedFrom)
        next[i] = p.copy(doc = doc, rev = p.rev + 1)
        return copy(pages = next, dirty = true)
    }

    /** "Re-do from master" on a resized page: it takes the document made from the master and is in step again. */
    fun redoFromMaster(pageId: String, doc: MarketingValue): DesignWork =
        copy(stale = stale.filter { it != pageId }).setDoc(pageId, doc, origin = "resized", syncedFrom = master)

    /** Pages from the resize sheet: ids made unique, `resized` from the master unless it says. */
    fun addPages(incoming: List<NewDesignPage>): DesignWork {
        if (incoming.isEmpty()) return this
        val next = pages.toMutableList()
        for (n in incoming) {
            if (next.size >= 24) break
            var id = nextPageId(next)
            val wanted = n.id
            if (wanted != null && DesignRecords.idOK(wanted) && next.none { it.id == wanted }) id = wanted
            val synced = n.syncedFrom ?: if (n.origin == "resized") master else null
            next.add(DesignPageState(id, n.label.take(60), n.format, n.w, n.h, n.origin, synced, 0, n.doc))
        }
        return copy(pages = next, active = next.last().id, dirty = true)
    }

    fun removePage(pageId: String): DesignWork {
        if (pages.size <= 1 || page(pageId) == null) return this
        val wasMaster = master == pageId
        val rest = pages.filter { it.id != pageId }
        val newMaster = if (wasMaster) rest[0].id else master
        // A page made from the one that went has nothing to follow: it stands on its own.
        val fixed = rest.map { p ->
            when {
                wasMaster && p.id == newMaster -> p.copy(origin = "master", syncedFrom = null)
                p.syncedFrom == pageId -> p.copy(origin = "manual", syncedFrom = null)
                else -> p
            }
        }
        return copy(
            pages = fixed, master = newMaster, active = if (active == pageId) newMaster else active,
            stale = stale.filter { it != pageId && it != newMaster }, dirty = true,
        )
    }

    fun setActive(pageId: String): DesignWork = if (page(pageId) != null) copy(active = pageId) else this

    /** Another page is the master: pages that followed the old one follow this, and are behind until re-done. */
    fun setMaster(pageId: String): DesignWork {
        if (pageId == master || page(pageId) == null) return this
        val old = master
        val next = pages.map { p ->
            when {
                p.id == pageId -> p.copy(origin = "master", syncedFrom = null)
                p.id == old -> p.copy(origin = "manual", syncedFrom = null)
                p.origin == "resized" && p.syncedFrom == old -> p.copy(syncedFrom = pageId)
                else -> p
            }
        }
        return copy(pages = next, master = pageId, stale = next.filter { it.origin == "resized" && it.syncedFrom == pageId }.map { it.id }, dirty = true)
    }

    /** The one-line state under a page in the strip (workspace.tsx PageStrip). */
    fun stripNote(p: DesignPageState): String = when {
        p.id == master -> "Master"
        p.origin == "manual" -> "Edited"
        p.id in stale -> "Behind the master"
        else -> "From the master"
    }

    // MARK: The save's meta (lib/design/model.ts designInput: the cleaner the server passes it through)

    /** The `meta` part of POST /api/design/designs: exactly the fields the web sends (`toInput`). */
    fun meta(thumb: String): MarketingValue {
        val o = LinkedHashMap<String, Any?>()
        o["name"] = displayName.take(120)
        o["folder"] = folder
        o["kind"] = kind
        o["scope"] = scope
        if (source.isNotEmpty()) o["source"] = source.mapValues { it.value.take(300) }
        o["fields"] = fieldKeys.associateWith { (fields[it] ?: "").take(300) }
        val c = LinkedHashMap<String, String>()
        for ((k, limit) in listOf("price" to 40, "wa" to 2000, "ig" to 2200, "adText" to 2000, "adHeadline" to 200, "link" to 500)) copy[k]?.let { c[k] = it.take(limit) }
        // The goal is one of lib/ads/plan GOALS; the server drops any other.
        copy["goal"]?.takeIf { it.isNotEmpty() }?.let { c["goal"] = it }
        o["copy"] = c
        o["pages"] = pages.map { p ->
            val d = linkedMapOf<String, Any?>(
                "id" to p.id, "label" to p.label.take(60), "format" to p.format, "frame" to mapOf("w" to p.w.roundToInt(), "h" to p.h.roundToInt()),
                "origin" to p.origin, "rev" to max(0, p.rev),
            )
            p.syncedFrom?.let { d["syncedFrom"] = it }
            d
        }
        o["master"] = master
        o["thumb"] = thumb
        return MarketingValue.of(o)
    }

    // MARK: Kept on the device (a draft)

    fun toValue(): MarketingValue = MarketingValue.of(
        mapOf(
            "id" to id, "name" to name, "folder" to folder, "kind" to kind, "scope" to scope, "source" to source, "fields" to fields, "copy" to copy,
            "pages" to pages.map { it.toValue() }, "master" to master, "active" to active, "stale" to stale, "fresh" to fresh, "dirty" to dirty, "template" to template,
        ),
    )

    companion object {
        val fieldKeys = listOf("kicker", "headline", "weight", "details")

        fun emptyFields(): Map<String, String> = fieldKeys.associateWith { "" }

        fun nextPageId(pages: List<DesignPageState>): String {
            var n = pages.size + 1
            while (pages.any { it.id == "p$n" }) n += 1
            return "p$n"
        }

        /** The master's first size is the master, the others are made from it. Laid out once the photo is in. */
        fun new(
            kind: String, sizes: List<DesignSizeChoice>, name: String = "", fields: Map<String, String> = emptyMap(),
            source: Map<String, String> = emptyMap(), copy: Map<String, String> = emptyMap(), template: String = "headline",
        ): DesignWork {
            val chosen = sizes.ifEmpty { DesignKinds.card(kind).sizes.map { DesignSizeChoice(it) } }
            val pages = ArrayList<DesignPageState>()
            for (c in chosen) {
                val z = c.size
                pages.add(
                    DesignPageState(
                        nextPageId(pages), z.label, z.format, z.w, z.h, if (pages.isEmpty()) "master" else "resized",
                        if (pages.isEmpty()) null else pages[0].id, 0, blankDoc(z.w, z.h),
                    ),
                )
            }
            val all = LinkedHashMap(emptyFields())
            for ((k, v) in fields) if (k in fieldKeys) all[k] = v
            return DesignWork(
                id = null, name = name, folder = null, kind = kind, scope = DesignKinds.scope(kind), source = source, fields = all, copy = copy,
                pages = pages, master = pages[0].id, active = pages[0].id, stale = emptyList(), fresh = true, dirty = false, template = template,
            )
        }

        /** A blank page: the photo as its ground (templates.ts blankAd), `placements` empty as the web's. */
        fun blankDoc(w: Double, h: Double): MarketingValue = MarketingValue.of(
            mapOf(
                "bg" to mapOf("photoId" to "photo", "placement" to mapOf("mode" to "fill", "zoom" to 1, "focusX" to 0.5, "focusY" to 0.5), "dim" to 0, "gradient" to "none", "color" to "#EDE6DA"),
                "layers" to emptyList<Any>(), "frame" to mapOf("w" to w, "h" to h), "placements" to emptyMap<String, Any>(),
            ),
        )

        /** A saved design opened: its record and each page's document (design-state.ts fromRecord). */
        fun from(r: DesignRecord, docs: Map<String, MarketingValue>): DesignWork? {
            val pages = ArrayList<DesignPageState>()
            for (p in r.pages) {
                val doc = docs[p.id] ?: return null
                pages.add(DesignPageState(p.id, p.label, p.format, p.w, p.h, p.origin, p.syncedFrom, p.rev, doc))
            }
            if (pages.isEmpty()) return null
            val master = if (pages.any { it.id == r.master }) r.master else pages[0].id
            val fields = LinkedHashMap(emptyFields())
            for (k in fieldKeys) r.fields[k]?.let { fields[k] = it }
            val template = pages.first { it.id == master }.doc["meta"].s("template")
            return DesignWork(
                id = r.id, name = r.name, folder = r.folder, kind = r.kind, scope = r.scope, source = r.source, fields = fields, copy = r.copy,
                pages = pages, master = master, active = master, stale = emptyList(), fresh = false, dirty = false, template = template.ifEmpty { "headline" },
            )
        }

        /** A draft read back (the inverse of [toValue]). */
        fun fromValue(v: MarketingValue): DesignWork? {
            val pages = v["pages"].array.map { DesignPageState.from(it) }
            if (pages.isEmpty()) return null
            fun strings(x: MarketingValue): Map<String, String> = x.obj.filterValues { it.json is kotlinx.serialization.json.JsonPrimitive && it.json !is kotlinx.serialization.json.JsonNull }.mapValues { it.value.string }
            val master = v.s("master").takeIf { m -> pages.any { it.id == m } } ?: pages[0].id
            return DesignWork(
                id = v.s("id").ifEmpty { null }, name = v.s("name"), folder = v.s("folder").ifEmpty { null }, kind = v.s("kind", "post"), scope = v.s("scope", "shop"),
                source = strings(v["source"]), fields = emptyFields() + strings(v["fields"]), copy = strings(v["copy"]), pages = pages, master = master,
                active = v.s("active").takeIf { a -> pages.any { it.id == a } } ?: master, stale = v["stale"].array.map { it.string }, fresh = v["fresh"].bool,
                dirty = v["dirty"].bool, template = v.s("template", "headline"),
            )
        }
    }
}

// MARK: The saved record (GET /api/design/designs → items[])

/** One `designs` record (lib/design/model.ts DesignRecord), read leniently from the server's JSON. */
class DesignRecord(v: MarketingValue) {
    class Page(val id: String, val label: String, val format: String, val w: Double, val h: Double, val origin: String, val syncedFrom: String?, val rev: Int)

    val id: String = v.s("id")
    val name: String = v.s("name")
    val folder: String? = v.s("folder").ifEmpty { null }
    val kind: String = v.s("kind", "post")
    val scope: String = v.s("scope", "shop")
    val source: Map<String, String> = strings(v["source"])
    val fields: Map<String, String> = strings(v["fields"])
    val copy: Map<String, String> = strings(v["copy"])
    val pages: List<Page> = v["pages"].array.map { p ->
        Page(
            p.s("id"), p.s("label"), p.s("format", "square"), p["frame"].n("w", 1080.0), p["frame"].n("h", 1080.0),
            p.s("origin", "master"), p.s("syncedFrom").ifEmpty { null }, p.n("rev").toInt(),
        )
    }
    val master: String = v.s("master")

    /** 'doc:<page>' | 'image:<page>' | 'photo:<id>' → parts. */
    val files: Map<String, Int> = v["files"].obj.mapValues { it.value.number.toInt() }

    /** A 200-px JPEG as a data URL, for the grid. */
    val thumb: String = v.s("thumb")
    val updated: String = v.s("updated")
    val by: String = v.s("by")

    val isLegacy: Boolean get() = id.startsWith("saved:")

    /** Opening needs a layout for every page (a legacy ad saved without one cannot be opened again). */
    val canOpen: Boolean get() = files.keys.any { it.startsWith("doc:") }

    private companion object {
        fun strings(x: MarketingValue): Map<String, String> {
            val out = LinkedHashMap<String, String>()
            for ((k, value) in x.obj) if (value.json is kotlinx.serialization.json.JsonPrimitive && (value.json as kotlinx.serialization.json.JsonPrimitive).isString) out[k] = value.string
            return out
        }
    }
}

/** The thumbnail's bytes, decoded from its data URL (null when it is not an image). */
object DesignThumb {
    fun bytes(dataUrl: String): ByteArray? {
        val comma = dataUrl.indexOf(',')
        if (comma < 0 || !dataUrl.startsWith("data:image/")) return null
        return try { java.util.Base64.getMimeDecoder().decode(dataUrl.substring(comma + 1)) } catch (e: IllegalArgumentException) { null }
    }
}

/** A folder of `ad_folders`, shared with Saved ads. */
class DesignFolder(val id: String, val name: String) {
    constructor(v: MarketingValue) : this(v.s("id"), v.s("name"))
}
