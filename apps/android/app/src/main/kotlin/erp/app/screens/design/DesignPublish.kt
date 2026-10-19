package erp.app.screens.design

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.screens.ads.AdsStudioHandoffs
import erp.app.screens.marketing.MarketingRequest
import erp.app.screens.marketing.MarketingValue
import erp.app.screens.marketing.NativeArtwork
import erp.app.screens.marketing.PostsStore
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.abs
import kotlin.math.min

// The Publish sheet's engine (DesignPublish.swift; src/app/design/publish-sheet.tsx, lib/design/{destinations,publish}.ts), ported line for
// line: the rows come from GET /api/design/destinations (a place the house or the role lacks is a row with its reason), each place says
// which picture it needs (WhatsApp and the website only ever get 1:1: "Make 1:1 from this"), and the send is a plan of STEPS run one at a
// time. A step that went leaves its result in `memory` and is never run again, so Retry runs only what failed and a group is never posted
// twice. Every success is noted on the saved design (PATCH { published }).
//
// The route and the fields are the web client's, the same as the iPhone sends:
//   website        POST /api/website/photos        folder, name, file            -> { rel }
//   set of the day PUT  /api/website/featured      { key: rel }
//   WhatsApp       POST /api/website/post          file, caption, targets=<key>, sitePiece   (one step per place; the community twin mirrors)
//   story          POST /api/instagram/story       file                          (Mina: the share sheet)
//   feed post      POST /api/instagram/post        file, caption                 (Mina: the share sheet)
//   Meta ad        POST /api/ads/images (file) -> hash/url, POST /api/ads/studio/creatives, then the hand-off to /ads/new?studio=
//   replace photo  POST /api/website/edits         id, file, stamped, design, shape=own, ai=[]
//   queue          POST /api/website/post/queue (+ /<id> files, PATCH ready, PATCH schedule), DELETE the half-made entry on failure
//   save           the workspace's own Save (POST /api/design/designs)

/** lib/design/destinations.ts, for pages. */
object DesignDestinations {
    val order = listOf("website", "featured", "whatsapp", "channel", "instagram-story", "instagram-post", "meta-ad", "site-replace")

    class Need(val ratio: String, val maxPx: Int)

    /** What each place takes: the ratio and the width it is drawn at (for "any", the longest side it may have). */
    val needs: Map<String, Need> = mapOf(
        "website" to Need("1:1", 3000), "featured" to Need("1:1", 3000), "whatsapp" to Need("1:1", 1600), "channel" to Need("1:1", 1600),
        "instagram-story" to Need("9:16", 1080), "instagram-post" to Need("1:1", 1440), "meta-ad" to Need("any", 2160), "site-replace" to Need("any", 3000),
    )

    /** sizes.ts DEST_SIZE. */
    val sizeId: Map<String, String> = mapOf(
        "website" to "website", "featured" to "website", "whatsapp" to "whatsapp", "channel" to "whatsapp", "instagram-story" to "story",
        "instagram-post" to "square", "meta-ad" to "portrait", "site-replace" to "website",
    )
    val ownPage: Set<String> = setOf("website", "featured", "site-replace")

    fun size(dest: String): DesignSize? = sizeId[dest]?.let { DesignSizes.size(it) }

    fun matches(p: DesignPageState, ratio: String): Boolean = when (ratio) {
        "1:1" -> abs(p.w / kotlin.math.max(1.0, p.h) - 1) < 0.01
        "9:16" -> abs(p.w / kotlin.math.max(1.0, p.h) - 9.0 / 16.0) < 0.01
        else -> true
    }

    class Pick(val page: DesignPageState?, val missing: DesignSize?)

    /**
     * The page a place takes: the master when it fits, else the first that does; none gives the size to make. The website takes the page
     * made for it ("Website 1:1", the catalogue stamp) before any other square.
     */
    fun pageFor(pages: List<DesignPageState>, master: String, dest: String): Pick {
        val ratio = needs[dest]?.ratio ?: "any"
        val fits = pages.filter { matches(it, ratio) }
        val own = if (dest in ownPage) fits.firstOrNull { it.label == size(dest)?.label } else null
        val page = own ?: fits.firstOrNull { it.id == master } ?: fits.firstOrNull()
        if (page != null) return Pick(page, null)
        return Pick(null, size(dest))
    }

    fun storyPage(pages: List<DesignPageState>): DesignPageState? = pages.firstOrNull { matches(it, "9:16") }

    fun outputPx(dest: String, page: DesignPageState): Int {
        val n = needs[dest] ?: return 1080
        if (n.ratio != "any") return n.maxPx
        return min(n.maxPx, (DesignSizes.size(page.format)?.px ?: 1080.0).toInt())
    }

    /** The file name base a design's pictures go out under. */
    fun slug(s: String): String {
        val cleaned = s.replace(Regex("[^\\w\\s-]+"), "").trim().replace(Regex("\\s+"), "-")
        val cut = cleaned.take(60)
        return cut.ifEmpty { "design" }
    }

    fun isMaisonFolder(folder: String): Boolean = folder == "The Maisons" || folder.endsWith("/The Maisons")
}

class DesignPublishModel(val model: DesignWorkspaceModel) {
    class Target(val key: String, val label: String)

    class Row(v: MarketingValue) {
        val id: String = v.s("id")
        val label: String = v.s("label")
        val available: Boolean = v["available"].bool
        val reason: String? = v.s("reason").ifEmpty { null }

        /** Instagram rows: "api" (the house's connection) or "share" (the phone's share sheet). */
        val mode: String? = v.s("mode").ifEmpty { null }
        val targets: List<Target> = v["targets"].array.map { Target(it.s("key"), it.s("label")) }
        val connectable: Boolean = v["connectable"].bool
    }

    class SiteCollection(val folder: String, val category: String, val collection: String) {
        val title: String get() = if (category == collection) collection else "$category · $collection"
    }

    enum class Status { Waiting, Running, Done, Failed, Manual }

    class StepState(val status: Status = Status.Waiting, val error: String? = null)

    class Step(
        val id: String,
        val dest: String,
        val label: String,
        val after: List<String> = emptyList(),
        /** Not run by `run()`: it waits for the person's own tap (the phone's share sheet). */
        val manual: Boolean = false,
        /** For a manual step: the picture to hand to the share sheet. */
        val share: (suspend () -> Pair<ByteArray, String>)? = null,
        val run: suspend () -> String,
    )

    class Missing(val dest: String, val size: DesignSize) {
        val label: String get() = "Make ${size.ratio} from this"
    }

    class Plan(val steps: List<Step>, val missing: List<Missing>)

    // What the server says
    var rows by mutableStateOf<List<Row>>(emptyList())
        private set
    var collections by mutableStateOf<List<SiteCollection>>(emptyList())
        private set
    var loaded by mutableStateOf(false)
        private set
    var loadError by mutableStateOf<String?>(null)
    var config by mutableStateOf(MarketingValue.NULL)
        private set
    var checks by mutableStateOf<List<MarketingValue>>(emptyList())
        private set
    var healthLoading by mutableStateOf(true)
        private set
    var healthFailed by mutableStateOf<String?>(null)

    /** The set of the day now on the home page (the file it would replace), when the house has one. */
    var featuredNow by mutableStateOf<String?>(null)
        private set

    // The choices
    var folder by mutableStateOf("")
    var websiteOn by mutableStateOf(false)
    var featured by mutableStateOf(false)
    var siteName by mutableStateOf("")
    var renaming by mutableStateOf(false)
    var house by mutableStateOf("")
    var waOn by mutableStateOf(false)
    var waKeys by mutableStateOf<List<String>>(emptyList())
    var storyOn by mutableStateOf(false)
    var postOn by mutableStateOf(false)
    var metaOn by mutableStateOf(false)
    var replaceOn by mutableStateOf(false)
    var saveOn by mutableStateOf(false)

    /** "now" | "hold" | "schedule" */
    var whenKind by mutableStateOf("now")
    var due by mutableStateOf<Instant>(Instant.now().plusSeconds(3600))
    var wa by mutableStateOf("")
    var ig by mutableStateOf("")
    var adText by mutableStateOf("")
    var adHeadline by mutableStateOf("")

    // The send
    var memory by mutableStateOf<Map<String, String>>(emptyMap())
        private set
    var states by mutableStateOf<Map<String, StepState>>(emptyMap())
        private set
    var busy by mutableStateOf(false)
    var confirming by mutableStateOf(false)
    var aiBusy by mutableStateOf(false)
    var note by mutableStateOf<String?>(null)
    var wordIssues by mutableStateOf<List<String>>(emptyList())

    /** Bumped on a whole send that went and on a refusal: the sheet's haptics (moneyFeedback). */
    var sent by mutableIntStateOf(0)
    var failures by mutableIntStateOf(0)
    var finished by mutableStateOf(false)
    var metaPath by mutableStateOf<String?>(null)
    private var seeded = false
    private val memoryKey: String
    private var cache = HashMap<String, ByteArray>()

    init {
        val w = model.work
        val kind = w?.kind ?: "post"
        val d = defaults(kind)
        websiteOn = d.website; waOn = d.wa; storyOn = d.story; postOn = d.post; metaOn = d.meta
        wa = w?.copy?.get("wa") ?: ""
        ig = w?.copy?.get("ig") ?: ""
        adText = w?.copy?.get("adText") ?: ""
        adHeadline = w?.copy?.get("adHeadline") ?: (w?.fields?.get("headline") ?: "")
        memoryKey = "design.publish.${House.id}." + (w?.id ?: w?.displayName ?: "design")
        memory = Prefs.string(memoryKey)?.let { text -> MarketingValue.parse(text).obj.mapValues { it.value.string } } ?: emptyMap()
    }

    class Defaults(val website: Boolean, val wa: Boolean, val story: Boolean, val post: Boolean, val meta: Boolean)

    companion object {
        /** What each kind of design ticks to begin with; the person changes it. */
        fun defaults(kind: String): Defaults = when (kind) {
            "piece" -> Defaults(true, true, true, false, false)
            "story" -> Defaults(false, false, true, false, false)
            "post" -> Defaults(false, true, false, true, false)
            "whatsapp" -> Defaults(false, true, false, false, false)
            "site" -> Defaults(true, false, false, false, false)
            "ad" -> Defaults(false, false, false, false, true)
            else -> Defaults(false, false, false, false, false)
        }

        const val FOLDER_KEY = "taheri_post_folder"
        const val WA_KEY = "design_wa_targets"

        /** The files the site sees get their names from the engine; this is only the base the other places use. */
        fun siteBase(siteName: String, headline: String): String = (if (siteName.trim().isEmpty()) headline else siteName).trim()

        fun isoSeconds(at: Instant): String = PostsStore.isoSeconds(at)
    }

    val work: DesignWork? get() = model.work
    val pages: List<DesignPageState> get() = model.work?.pages ?: emptyList()
    val fromSite: Boolean get() = (model.work?.source?.get("siteId") ?: "").isNotEmpty()
    val sitePiece: String? get() = if (fromSite) model.work?.source?.get("siteId") else null

    fun row(id: String): Row? = rows.firstOrNull { it.id == id }
    fun ok(id: String): Boolean = row(id)?.available == true
    fun igMode(id: String): String = row(id)?.mode ?: "share"
    val siteLink: String get() = work?.copy?.get("link")?.takeIf { it.isNotEmpty() } ?: config.s("site")
    val isMaison: Boolean get() = DesignDestinations.isMaisonFolder(folder)

    // MARK: Loading

    suspend fun load() {
        try {
            val d = if (House.isDemo) DesignDemo.destinations() else MarketingRequest.get("/api/design/destinations?collections=1" + if (fromSite) "&fromSite=1" else "")
            rows = d["rows"].array.map { Row(it) }
            collections = d["collections"].array.map { SiteCollection(it.s("folder"), it.s("category"), it.s("collection")) }
            seed()
            loaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            loadError = e.message
        }
        config = if (House.isDemo) DesignDemo.config() else runCatching { MarketingRequest.get("/api/app/website") }.getOrNull() ?: MarketingValue.NULL
        if (config["featured"].bool && !House.isDemo) {
            featuredNow = runCatching { MarketingRequest.get("/api/website/featured") }.getOrNull()?.get("featured")?.takeUnless { it.isNull }?.s("file")?.ifEmpty { null }
        }
        refreshHealth()
    }

    /** The remembered collection and WhatsApp places, once the rows say what exists. */
    private fun seed() {
        val last = Prefs.string("$FOLDER_KEY.${House.id}") ?: ""
        if (last.isNotEmpty() && collections.any { it.folder == last }) folder = last
        val all = (row("whatsapp")?.targets ?: emptyList()) + (row("channel")?.targets ?: emptyList())
        val wanted = (Prefs.string("$WA_KEY.${House.id}") ?: "").split(',').filter { k -> k.isNotEmpty() && all.any { it.key == k } }
        waKeys = wanted.ifEmpty { (row("whatsapp")?.targets ?: emptyList()).take(1).map { it.key } + (row("channel")?.targets ?: emptyList()).map { it.key } }
        if (!ok("website")) websiteOn = false
        if (!ok("whatsapp") && !ok("channel")) waOn = false
        if (!ok("meta-ad")) metaOn = false
        seeded = true
    }

    /** The collection and the WhatsApp places are remembered on this device, as the web's sheet does. */
    fun remember() {
        if (!seeded) return
        if (folder.isNotEmpty()) Prefs.putString("$FOLDER_KEY.${House.id}", folder)
        if (waKeys.isNotEmpty()) Prefs.putString("$WA_KEY.${House.id}", waKeys.joinToString(","))
    }

    suspend fun refreshHealth() {
        healthLoading = true
        if (House.isDemo) { checks = DesignDemo.checks(); healthFailed = null; healthLoading = false; return }
        try {
            val r = MarketingRequest.get("/api/website/post/health")
            checks = r["checks"].array
            healthFailed = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            healthFailed = "The checks could not run. " + (e.message ?: "")
        }
        healthLoading = false
    }

    // MARK: Choices → steps

    private fun label(key: String): String {
        if (key == "channel") return "WhatsApp channel"
        return "WhatsApp · " + (((row("whatsapp")?.targets ?: emptyList()) + (row("channel")?.targets ?: emptyList())).firstOrNull { it.key == key }?.label ?: key)
    }

    /** The WhatsApp places that are on, held to what the house has. */
    val whatsappChoice: List<String> get() = if (waOn) waKeys.filter { if (it == "channel") ok("channel") else ok("whatsapp") } else emptyList()
    val websiteOK: Boolean get() = websiteOn && ok("website") && folder.isNotEmpty()

    fun pick(dest: String): DesignDestinations.Pick = DesignDestinations.pageFor(pages, work?.master ?: "", dest)
    fun missing(dest: String): Missing? = pick(dest).missing?.let { Missing(dest, it) }

    /** "Make 1:1 from this": the page for a destination's shape, by the resize engine (or the catalogue's own for the website). */
    suspend fun make(m: Missing) {
        model.makeSize(m.size.id)
        cache = HashMap()
    }

    private suspend fun picture(pageId: String, px: Int): ByteArray {
        val key = "$pageId@$px"
        cache[key]?.let { return it }
        val data = model.render(pageId, px)
        cache[key] = data
        return data
    }

    private suspend fun morePicture(pageId: String, photoId: String, px: Int): ByteArray {
        val key = "$pageId@$px#$photoId"
        cache[key]?.let { return it }
        val data = model.renderWith(pageId, photoId, px)
        cache[key] = data
        return data
    }

    private fun siteBase(): String = siteBase(siteName, work?.fields?.get("headline") ?: "")

    /** The files the site sees: "Bangle and Ring.jpg", a Maisons piece "<House> — <Model>.jpg" (the bundled engine's own names). */
    private suspend fun siteNames(count: Int): List<String> {
        val name = siteBase().ifEmpty { work?.displayName ?: "design" }
        val r = model.engine.run(
            NativeArtwork.blank(null, 1080.0), emptyMap(), work?.fields ?: emptyMap(),
            mapOf("px" to 120, "name" to name, "count" to maxOf(1, count), "folder" to folder, "maisonHouse" to house),
        )
        val names = r["names"].array.map { it.string }
        if (names.size < count) throw ErpApi.Failure(0, "The website names could not be made.")
        return names
    }

    val queued: Boolean get() = whenKind != "now"

    /** publish.ts buildPlan. */
    fun plan(): Plan {
        val w = work ?: return Plan(emptyList(), emptyList())
        val steps = ArrayList<Step>()
        val missing = ArrayList<Missing>()
        val base = DesignDestinations.slug((w.fields["headline"] ?: "").ifEmpty { w.displayName })
        val master = w.master
        fun pageOf(dest: String): DesignPageState? {
            val p = DesignDestinations.pageFor(w.pages, master, dest)
            if (p.page != null) return p.page
            if (p.missing != null && missing.none { it.dest == dest }) missing.add(Missing(dest, p.missing))
            return null
        }
        val moreIds = model.moreIds
        val extras = (0 until moreIds.size).map { it + 1 }
        val waPlaces = whatsappChoice.filter { it != "channel" }
        val channel = whatsappChoice.contains("channel")
        val website = if (websiteOK) pageOf("website") else null
        val waPage: DesignPageState? = if (waPlaces.isNotEmpty() || channel) pageOf(if (waPlaces.isEmpty()) "channel" else "whatsapp") else null
        val storyDest = if (storyOn) pageOf("instagram-story") else null
        val postDest = if (postOn) pageOf("instagram-post") else null
        val metaDest = if (metaOn && ok("meta-ad")) pageOf("meta-ad") else null
        val replaceDest: DesignPageState? = if (replaceOn && ok("site-replace") && sitePiece != null) pageOf("site-replace") else null
        val featuredPage = if (websiteOK && featured && ok("featured")) website else null
        val q = queued
        val folder = this.folder
        val wasFeatured = featuredPage != null

        if (saveOn) {
            steps.add(
                Step("save", "save", "Save the design", run = {
                    val record = model.saveToShop()
                    if (record == null) {
                        val why = model.error ?: "The design could not be saved."
                        model.error = null
                        throw ErpApi.Failure(0, why)
                    }
                    record.id
                }),
            )
        }

        val storyQueued = if (q && igMode("instagram-story") == "api") storyDest else null

        if (!q && website != null) {
            val count = 1 + extras.size
            steps.add(
                Step("website", "website", "Website", run = {
                    val names = siteNames(count)
                    DesignSend.website(picture(website.id, DesignDestinations.outputPx("website", website)), folder, names[0])
                }),
            )
            for (i in extras) {
                steps.add(
                    Step("website:$i", "website", "Website · photo ${i + 1}", after = listOf("website"), run = {
                        val names = siteNames(count)
                        DesignSend.website(morePicture(website.id, moreIds[i - 1], DesignDestinations.outputPx("website", website)), folder, names[i])
                    }),
                )
            }
            if (wasFeatured) {
                steps.add(
                    Step("featured", "featured", "Set of the day", after = listOf("website"), run = {
                        val rel = memory["website"] ?: throw ErpApi.Failure(0, "The website photo has not gone yet.")
                        DesignSend.feature(rel)
                        rel
                    }),
                )
            }
        }
        if (storyDest != null && storyQueued == null) {
            val manual = igMode("instagram-story") == "share"
            steps.add(
                Step(
                    "instagram-story", "instagram-story", "Instagram story", manual = manual,
                    share = { picture(storyDest.id, DesignDestinations.outputPx("instagram-story", storyDest)) to "$base-story.jpg" },
                    run = { DesignSend.story(picture(storyDest.id, DesignDestinations.outputPx("instagram-story", storyDest))) },
                ),
            )
        }
        // Each place its own step, so one that fails is retried alone: never a group twice.
        if (!q && waPage != null) {
            val caption = this.wa
            val sp = sitePiece
            for (key in waPlaces + (if (channel) listOf("channel") else emptyList())) {
                val dest = if (key == "channel") "channel" else "whatsapp"
                steps.add(
                    Step("wa:$key", dest, label(key), run = {
                        // 1600 px: WhatsApp makes no preview for images over 3000 px and shrinks everything to about this anyway.
                        DesignSend.whatsapp(key, picture(waPage.id, DesignDestinations.outputPx("whatsapp", waPage)), "$base.jpg", caption, sp)
                    }),
                )
                for (i in extras) {
                    steps.add(
                        Step("wa:$key:$i", dest, label(key) + " · photo ${i + 1}", after = listOf("wa:$key"), run = {
                            DesignSend.whatsapp(key, morePicture(waPage.id, moreIds[i - 1], DesignDestinations.outputPx("whatsapp", waPage)), "$base-${i + 1}.jpg", "", sp)
                        }),
                    )
                }
            }
        }
        if (q && (website != null || waPage != null || storyQueued != null)) {
            // One queue entry carries the website, WhatsApp and story sends; the tick (or "send now") makes them, and retries only what failed.
            val dueAt: String? = if (whenKind == "schedule") isoSeconds(due) else null
            val caption = this.wa
            val keys = if (waPage != null) waPlaces + (if (channel) listOf("channel") else emptyList()) else emptyList()
            val count = 1 + extras.size
            val sp = sitePiece
            steps.add(
                Step("queue", "queue", if (dueAt != null) "Schedule in the post queue" else "Hold in the post queue", run = {
                    val images = LinkedHashMap<String, ByteArray>()
                    if (website != null) images["site-0"] = picture(website.id, DesignDestinations.outputPx("website", website))
                    if (waPage != null) images["wa-0"] = picture(waPage.id, DesignDestinations.outputPx("whatsapp", waPage))
                    for (i in extras) {
                        if (website != null) images["site-$i"] = morePicture(website.id, moreIds[i - 1], DesignDestinations.outputPx("website", website))
                        if (waPage != null) images["wa-$i"] = morePicture(waPage.id, moreIds[i - 1], DesignDestinations.outputPx("whatsapp", waPage))
                    }
                    if (storyQueued != null) images["story"] = picture(storyQueued.id, DesignDestinations.outputPx("instagram-story", storyQueued))
                    val lead = website ?: waPage ?: storyQueued
                    val thumb = if (lead != null) runCatching { picture(lead.id, 240) }.getOrNull() else null
                    var names = emptyList<String>()
                    if (website != null) names = siteNames(count)
                    DesignSend.queue(
                        (w.fields["headline"] ?: "").ifEmpty { w.displayName }, caption, base, sp,
                        if (website != null) DesignSend.QueueSite(folder, names, wasFeatured) else null, keys, count, images, thumb, dueAt,
                    )
                }),
            )
        }
        // A feed post is never queued (the queue carries stories): it goes now, whichever way the rest goes.
        if (postDest != null) {
            val caption = ig
            steps.add(
                Step(
                    "instagram-post", "instagram-post", "Instagram post", manual = igMode("instagram-post") == "share",
                    share = { picture(postDest.id, DesignDestinations.outputPx("instagram-post", postDest)) to "$base-post.jpg" },
                    run = { DesignSend.post(picture(postDest.id, DesignDestinations.outputPx("instagram-post", postDest)), caption) },
                ),
            )
        }
        if (metaDest != null) {
            val text = adText.ifEmpty { listOf(w.fields["headline"], w.fields["weight"], w.fields["details"]).filterNotNull().filter { it.isNotEmpty() }.joinToString("\n") }
            val headline = adHeadline.ifEmpty { w.fields["headline"] ?: "" }
            val goal = w.copy["goal"]?.takeIf { it.isNotEmpty() } ?: "whatsapp"
            val link = siteLink
            steps.add(
                Step("meta-ad", "meta-ad", "Meta ad", run = {
                    // One ad, both sizes: a feed-shaped main picture gets the 9:16 page as its second asset.
                    val feed = metaDest.format == "portrait" || metaDest.format == "square"
                    var vertical: ByteArray? = null
                    if (feed) DesignDestinations.storyPage(w.pages)?.let { vertical = picture(it.id, 1080) }
                    val main = picture(metaDest.id, DesignDestinations.outputPx("meta-ad", metaDest))
                    DesignSend.metaAd(main, vertical, w.displayName, headline, text, goal, link, metaDest.format)
                }),
            )
        }
        if (replaceDest != null && sitePiece != null) {
            val sp = sitePiece!!
            val stamped = model.marked
            steps.add(
                Step("site-replace", "site-replace", "Replace the photo on the website", run = {
                    DesignSend.siteReplace(sp, picture(replaceDest.id, DesignDestinations.outputPx("site-replace", replaceDest)), stamped, replaceDest.doc)
                }),
            )
        }
        return Plan(steps, missing)
    }

    // MARK: Reading the state

    fun state(s: Step): StepState {
        if (memory[s.id] != null) return StepState(Status.Done)
        return states[s.id] ?: StepState(if (s.manual) Status.Manual else Status.Waiting)
    }

    fun ref(id: String): String? = memory[id]

    /** Problems that stop a send before it starts. */
    fun problems(p: Plan): List<String> {
        val out = ArrayList<String>()
        if (websiteOn && ok("website") && folder.isEmpty()) out.add("Choose a website collection, or switch the website off.")
        if (websiteOn && ok("website") && isMaison && house.isEmpty()) out.add("Choose the piece’s house for The Maisons.")
        if (waOn && ok("whatsapp") && whatsappChoice.isEmpty()) out.add("Choose a WhatsApp group or the channel, or switch WhatsApp off.")
        if (whenKind == "schedule" && !due.isAfter(Instant.now())) out.add("Choose a time to send it.")
        if (p.steps.isEmpty() && p.missing.isEmpty()) out.add("Choose where it goes.")
        return out
    }

    /** The house rules on the words about to go out (the bundled engine's wordProblems): sale words, hashtags, figures the specs don't give. */
    suspend fun checkWords() {
        val texts = mapOf(
            "WhatsApp caption" to (if (whatsappChoice.isEmpty()) "" else wa), "Instagram caption" to (if (postOn) ig else ""),
            "ad text" to (if (metaOn && ok("meta-ad")) adText else ""), "ad headline" to (if (metaOn && ok("meta-ad")) adHeadline else ""),
        )
        if (texts.values.none { it.trim().isNotEmpty() }) { wordIssues = emptyList(); return }
        wordIssues = try {
            val r = model.engine.run(NativeArtwork.blank(null, 1080.0), emptyMap(), emptyMap(), mapOf("action" to "words", "px" to 120, "texts" to texts, "facts" to (work?.fields?.get("weight") ?: "")))
            r["problems"].array.map { it.string }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun failingGroups(p: Plan): List<String> {
        val groups = ArrayList<String>()
        for (s in p.steps) {
            if (memory[s.id] != null) continue
            val g = when (s.dest) {
                "website", "featured", "site-replace" -> "Website"
                "whatsapp", "channel" -> "WhatsApp"
                "instagram-story", "instagram-post" -> "Instagram"
                else -> null
            }
            if (g != null && g !in groups && checks.any { it.s("status") == "fail" && it.s("group") == g }) groups.add(g)
        }
        return groups
    }

    // MARK: Running

    private fun saveMemory() { Prefs.putString(memoryKey, MarketingValue.of(memory).text) }

    /**
     * Runs what is left. A step with a result in `memory` is done and skipped; a manual step waits for the person; a step whose `after`
     * has no result fails without running; the others run one at a time, each result going into `memory` before the next begins. A failure
     * does not stop the rest. Called again, it retries only the failures (or just [only]).
     */
    suspend fun run(only: String? = null) {
        busy = true; confirming = false; note = null
        val p = plan()
        var failed = false
        for (step in p.steps) {
            if (only != null && step.id != only) continue
            if (memory[step.id] != null || step.manual) continue
            val blocked = step.after.firstOrNull { memory[it] == null }
            if (blocked != null) {
                states = states + (step.id to StepState(Status.Failed, "${p.steps.firstOrNull { it.id == blocked }?.label ?: "The step before it"} has not gone yet."))
                failed = true
                continue
            }
            states = states + (step.id to StepState(Status.Running))
            try {
                val ref = step.run()
                memory = memory + (step.id to ref.ifEmpty { "sent" })
                saveMemory()
                states = states + (step.id to StepState(Status.Done))
                if (step.id == "meta-ad") metaPath = memory[step.id]
                if (step.id != "save") model.recordPublish(step.id, true, memory[step.id])
            } catch (e: CancellationException) {
                busy = false
                throw e
            } catch (e: Exception) {
                states = states + (step.id to StepState(Status.Failed, e.message ?: "It did not go."))
                failed = true
            }
        }
        busy = false
        if (failed) failures += 1
        val left = plan().steps.filter { memory[it.id] == null }
        if (left.isNotEmpty() || failed) refreshHealth()
        if (left.isEmpty() && p.steps.isNotEmpty() && !failed) {
            sent += 1
            finished = true
            if (model.work?.id != null) model.finish()
            model.say("Sent", "Everything you chose has gone.")
        }
    }

    /** The person did the step themselves (shared the story from the phone). */
    suspend fun markDone(id: String, ref: String = "shared") {
        memory = memory + (id to ref)
        saveMemory()
        states = states + (id to StepState(Status.Done))
        model.recordPublish(id, true, ref)
    }

    fun forgetAll() {
        memory = emptyMap()
        states = emptyMap()
        saveMemory()
        finished = false
    }

    // MARK: Words and pictures to hand over

    /** Both captions, written from the picture (the same op Post a piece's caption writer calls). */
    suspend fun writeCaptions() {
        val w = work ?: return
        val page = pages.firstOrNull { it.id == w.master } ?: pages.firstOrNull() ?: return
        aiBusy = true; note = null
        try {
            val image = model.render(page.id, 1024)
            val numbers = config["posting"]["whatsappNumbers"].array.map { it.string }
            val r = MarketingRequest.ai(
                "caption", listOf(image),
                mapOf(
                    "headline" to (w.fields["headline"] ?: ""), "weight" to (w.fields["weight"] ?: ""), "metal" to "", "stones" to "",
                    "collection" to (folder.split('/').filter { it.isNotEmpty() }.drop(1).firstOrNull() ?: ""), "numbers" to numbers, "link" to config.s("site"), "brief" to "",
                ),
            )
            val c = r["caption"]
            if (c.s("whatsappCaption").isNotEmpty()) wa = c.s("whatsappCaption")
            if (c.s("instagramCaption").isNotEmpty()) ig = c.s("instagramCaption")
            checkWords()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            note = e.message
        } finally {
            aiBusy = false
        }
    }

    suspend fun connectInstagram(): String? {
        return try {
            val r = MarketingRequest.send("/api/instagram/connect")
            r.s("url").takeIf { it.startsWith("http") } ?: throw ErpApi.Failure(0, "Instagram sent no address to connect.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            note = e.message
            null
        }
    }

    /** Every size as files for the share sheet ("Save all to Photos", "Download every size"). */
    suspend fun allSizes(): List<Pair<String, ByteArray>> {
        val w = work ?: return emptyList()
        val base = DesignDestinations.slug((w.fields["headline"] ?: "").ifEmpty { w.displayName })
        val out = ArrayList<Pair<String, ByteArray>>()
        for (p in w.pages) {
            val px = (DesignSizes.size(p.format)?.px ?: 1080.0).toInt()
            out.add("$base-${DesignDestinations.slug(p.label)}.jpg" to picture(p.id, px))
        }
        return out
    }

    /** The WhatsApp picture, ready to share with its caption (the caption goes to the clipboard too: WhatsApp often drops text shared with a file). */
    suspend fun captioned(): Pair<String, ByteArray> {
        val page = pick("whatsapp").page
        val w = work
        if (page == null || w == null) throw ErpApi.Failure(0, "Make a 1:1 size first (Make 1:1 from this).")
        val base = DesignDestinations.slug((w.fields["headline"] ?: "").ifEmpty { w.displayName })
        return "$base.jpg" to picture(page.id, 1600)
    }

    suspend fun shareFile(step: Step): Pair<String, ByteArray> {
        val share = step.share ?: throw ErpApi.Failure(0, "There is nothing to share.")
        val r = share()
        if (step.id == "instagram-post" && ig.trim().isNotEmpty()) note = "The caption is copied: paste it in Instagram."
        return r.second to r.first
    }
}

// MARK: The senders

object DesignSend {
    private fun jpeg(data: ByteArray, name: String = "photo.jpg") = ErpApi.FormFile("file", name, "image/jpeg", data)
    private suspend fun form(path: String, fields: List<Pair<String, String>>, files: List<ErpApi.FormFile>, timeoutMs: Long): MarketingValue =
        MarketingValue.parse(ErpApi.shared.upload(path, fields, files, timeoutMs = timeoutMs))

    suspend fun website(data: ByteArray, folder: String, name: String): String =
        form("/api/website/photos", listOf("folder" to folder, "name" to name), listOf(jpeg(data)), 120_000).s("rel", "uploaded")

    /** The set of the day (WebsiteStore.feature): PUT /api/website/featured { key }. */
    suspend fun feature(key: String) { ErpApi.shared.data("/api/website/featured", "PUT", mapOf("key" to key)) }

    suspend fun whatsapp(key: String, data: ByteArray, name: String, caption: String, sitePiece: String?): String {
        val fields = ArrayList<Pair<String, String>>()
        if (caption.isNotEmpty()) fields.add("caption" to caption)
        fields.add("targets" to key)
        if (!sitePiece.isNullOrEmpty()) fields.add("sitePiece" to sitePiece)
        return form("/api/website/post", fields, listOf(jpeg(data, "photo.jpg")), 300_000).s("idMessage", "sent")
    }

    suspend fun story(data: ByteArray): String = form("/api/instagram/story", emptyList(), listOf(jpeg(data)), 180_000).s("mediaId", "posted")

    suspend fun post(data: ByteArray, caption: String): String {
        val text = caption.trim()
        return form("/api/instagram/post", if (text.isEmpty()) emptyList() else listOf("caption" to text), listOf(jpeg(data, "post.jpg")), 180_000).s("mediaId", "posted")
    }

    suspend fun siteReplace(id: String, data: ByteArray, stamped: Boolean, doc: MarketingValue): String {
        form("/api/website/edits", listOf("id" to id, "stamped" to (if (stamped) "1" else "0"), "design" to doc.text, "shape" to "own", "ai" to "[]"), listOf(jpeg(data)), 130_000)
        return id
    }

    /** The ad in the ad account's library and the hand-off New ad reads (as the Studio's own `newAd`); resolves to the address to open. */
    suspend fun metaAd(main: ByteArray, vertical: ByteArray?, name: String, headline: String, text: String, goal: String, link: String, format: String): String {
        suspend fun upload(data: ByteArray, n: String): MarketingValue = form("/api/ads/images", emptyList(), listOf(jpeg(data, n)), 120_000)
        val base = DesignDestinations.slug(headline.ifEmpty { name })
        val up = upload(main, "$base.jpg")
        var vert = MarketingValue.NULL
        if (vertical != null) vert = upload(vertical, "$base-9x16.jpg")
        runCatching { MarketingRequest.send("/api/ads/studio/creatives", mapOf("assets" to emptyList<Any>(), "hash" to up.s("hash"), "url" to up["url"].any, "format" to format, "name" to headline)) }
        val key = java.util.UUID.randomUUID().toString().take(8).lowercase()
        val photo = linkedMapOf<String, Any?>("hash" to up.s("hash"), "url" to up["url"].any, "headline" to headline)
        if (link.isNotEmpty()) photo["link"] = link
        val second: Any? = if (!vert.isNull) mapOf("hash" to vert.s("hash"), "url" to vert["url"].any) else null
        val handoff = linkedMapOf<String, Any?>(
            "photos" to listOf(photo), "vertical" to second, "text" to text, "headline" to headline, "goal" to goal, "name" to name + (if (vert.isNull) "" else " + 9:16"),
        )
        if (link.isNotEmpty()) handoff["link"] = link
        AdsStudioHandoffs.ads[key] = handoff
        return "/ads/new?studio=$key"
    }

    class QueueSite(val folder: String, val names: List<String>, val featured: Boolean)

    /** The post queue (as Post a piece and the Board call it): the entry, its pictures, then "ready" (held), then a time if there is one. */
    suspend fun queue(
        headline: String, caption: String, fileBase: String, sitePiece: String?, website: QueueSite?, whatsapp: List<String>,
        count: Int, images: Map<String, ByteArray>, thumb: ByteArray?, dueAt: String?,
    ): String {
        var qid: String? = null
        try {
            val counts = mapOf("site" to (if (website != null) count else 0), "wa" to (if (whatsapp.isEmpty()) 0 else count), "story" to (images["story"] != null))
            val body = linkedMapOf<String, Any?>(
                "headline" to headline, "caption" to caption, "fileBase" to fileBase, "counts" to counts, "instagram" to (images["story"] != null), "whatsapp" to whatsapp,
            )
            body["website"] = if (website != null) {
                mapOf("folder" to website.folder, "collection" to (website.folder.split('/').filter { it.isNotEmpty() }.drop(1).firstOrNull() ?: website.folder), "names" to website.names, "featured" to website.featured)
            } else null
            if (thumb != null) body["thumb"] = java.util.Base64.getEncoder().encodeToString(thumb)
            if (!sitePiece.isNullOrEmpty()) body["sitePiece"] = sitePiece
            val made = MarketingRequest.send("/api/website/post/queue", body)
            qid = made["item"].s("id")
            val id = qid
            if (id.isNullOrEmpty()) throw ErpApi.Failure(0, "The queue gave no entry.")
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
            if (!id.isNullOrEmpty()) runCatching { MarketingRequest.send("/api/website/post/queue/$id", method = "DELETE") }
            throw e
        }
    }
}

