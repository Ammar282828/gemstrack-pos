package erp.app.screens.ads

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import com.google.firebase.auth.FirebaseAuth
import erp.app.ErpApp
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.data.JsonText
import erp.core.Container
import erp.core.Decodable
import erp.core.Json
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

// The server calls (AdsKit.swift, AdsWorkKit.swift AdsAPI). They run as the signed-in person (ErpApi sends the ID
// token); /api/ads/* answers owners and marketing accounts only (src/lib/ads/gate.ts), the same as the web's Ads
// pages. Meta is never called from the phone.

/** What the screens ask of the ERP. The screens read it from [LocalAdsBackend]; a screenshot test hands them fixtures. */
interface AdsBackend {
    suspend fun overview(range: String, fresh: Boolean): AdOverview
    suspend fun campaigns(range: String, archived: Boolean): AdCampaigns

    /** Run or pause one campaign, ad set or ad (`level` is "campaign", "adset" or "ad"). */
    suspend fun setRunning(level: String, id: String, running: Boolean)
    suspend fun setBudget(level: String, id: String, daily: Double?, lifetime: Double?)
    suspend fun setEnd(level: String, id: String, end: Instant?)

    suspend fun status(): AdsStatusAnswer
    suspend fun newAdLists(): AdsNewAdLists
    suspend fun checkPlan(plan: Map<String, Any?>): AdsPlanCheck
    suspend fun checkDesign(design: Map<String, Any?>): AdsDesignCheck
    suspend fun create(plan: Map<String, Any?>): AdsMade
    suspend fun adsetsInfo(campaign: String?, from: String?): AdsAdsetsInfo
    suspend fun makeAdsets(design: Map<String, Any?>): AdsDesignMade
    suspend fun media(after: String?): AdsMediaAnswer
    suspend fun library(after: String?): AdsLibraryAnswer
    suspend fun imageFromPiece(pieceId: String): AdsImageAnswer
    suspend fun preview(plan: Map<String, Any?>): List<AdsPreview>
    suspend fun template(ad: String): AdsTemplate
    suspend fun sitePieces(): List<AdsSitePiece>
    suspend fun upload(jpeg: ByteArray): AdsImageAnswer

    suspend fun places(q: String): List<AdsPlace>
    suspend fun interests(q: String): List<AdsInterestHit>
    suspend fun suggestions(names: List<String>): List<AdsInterestHit>
    suspend fun estimate(draft: AdsAudience, goal: String): AdsEstimate

    suspend fun audiences(): AdsAudiencesAnswer
    suspend fun makeAudience(body: Map<String, Any?>): AdsAudienceMade
    suspend fun deleteAudience(id: String)
    suspend fun rules(): AdsRulesAnswer
    suspend fun makeRule(kind: String, amount: Double)
    suspend fun setRule(id: String, enabled: Boolean)
    suspend fun deleteRule(id: String)
    suspend fun setupAssets(): AdsSetupAssets
    suspend fun saveSetup(patch: Map<String, Any?>): AdsSettingsRow?
    suspend fun disconnect()
    suspend fun pixel(): AdsPixelAnswer
    suspend fun pixelAct(body: Map<String, Any?>)

    /** The campaign, ad set or ad menu's own answer (`/api/ads/object/<id>?level=`), as the raw object the page lists. */
    suspend fun objectDetail(id: String, level: String): Map<String, Any?>
    suspend fun objectAct(id: String, level: String, action: String, fields: Map<String, Any?>)
}

val LocalAdsBackend = staticCompositionLocalOf<AdsBackend> { AdsAPI }

/** A website piece for New ad's grid (Posts' PostPiece; TODO(shared): MarketingKit's piece model when it lands). */
data class AdsSitePiece(
    val id: String,
    val name: String,
    /** The piece's page on the site. */
    val url: String,
    val thumb: String,
    val collection: String,
    val weightGrams: Double?,
    val facts: List<String>,
    val newArrival: Boolean,
    val hidden: Boolean,
) {
    companion object : Decodable<AdsSitePiece> {
        override fun fromMap(m: Map<String, Any?>): AdsSitePiece {
            val c = Container(m)
            val small = c.string("thumb", "")
            return AdsSitePiece(
                c.string("id", ""), c.string("name", ""), c.string("url", ""), small.ifEmpty { c.string("image", "") }, c.string("collection", ""),
                c.double("weightGrams"), c.strings("facts"), c.bool("newArrival", false), c.bool("hidden", false),
            )
        }
    }
}

object AdsAPI : AdsBackend {
    private val api get() = ErpApi.shared

    private suspend fun <T : Any> read(path: String, model: Decodable<T>, method: String = "GET", json: Map<String, Any?>? = null, timeoutMs: Long = 60_000): T {
        val text = api.data(path, method, json, timeoutMs)
        return model.from(Json.parse(text)) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
    }

    override suspend fun overview(range: String, fresh: Boolean): AdOverview =
        read("/api/ads/overview?range=$range${if (fresh) "&fresh=1" else ""}", AdOverview)

    override suspend fun campaigns(range: String, archived: Boolean): AdCampaigns =
        read("/api/ads/campaigns?range=$range${if (archived) "&archived=1" else ""}", AdCampaigns)

    /** The route the web's switches call, which checks the object is this house's and records the change in `ads_log`. */
    override suspend fun setRunning(level: String, id: String, running: Boolean) {
        api.send("/api/ads/object/$id", body = mapOf("level" to level, "action" to "status", "status" to if (running) "ACTIVE" else "PAUSED"))
    }

    /** A campaign's or ad set's budget, in the account's own money (the route turns it into Meta's units). */
    override suspend fun setBudget(level: String, id: String, daily: Double?, lifetime: Double?) {
        val body = LinkedHashMap<String, Any?>()
        body["level"] = level
        body["action"] = "budget"
        if (daily != null) body["daily"] = daily else if (lifetime != null) body["lifetime"] = lifetime
        api.send("/api/ads/object/$id", body = body)
    }

    /** When it stops (a campaign's stop time, an ad set's end time); null runs it with no end. */
    override suspend fun setEnd(level: String, id: String, end: Instant?) {
        api.send("/api/ads/object/$id", body = mapOf("level" to level, "action" to "schedule", "end" to end?.let { AdsTime.iso(it) }))
    }

    override suspend fun status(): AdsStatusAnswer = read("/api/ads/status", AdsStatusAnswer)

    /** What New ad offers in this house: goals and buttons in the web's words, the links, the quiet days ahead. */
    override suspend fun newAdLists(): AdsNewAdLists = read("/api/ads/plan", AdsNewAdLists)

    /** What stops the ad and what it will do and cost (planSummary), before anything is made. */
    override suspend fun checkPlan(plan: Map<String, Any?>): AdsPlanCheck = read("/api/ads/plan", AdsPlanCheck, "POST", mapOf("plan" to plan))

    override suspend fun checkDesign(design: Map<String, Any?>): AdsDesignCheck = read("/api/ads/plan", AdsDesignCheck, "POST", mapOf("design" to design))

    /** Campaign → ad set → ad, paused or live as the plan says (checks the plan again, deletes a half-made campaign on any failure). Meta can take a while. */
    override suspend fun create(plan: Map<String, Any?>): AdsMade = read("/api/ads/create", AdsMade, "POST", mapOf("plan" to plan), 130_000)

    override suspend fun adsetsInfo(campaign: String?, from: String?): AdsAdsetsInfo {
        var path = "/api/ads/adsets"
        if (from != null) path += "?from=${AdsQuery.escape(from)}" else if (campaign != null) path += "?campaign=${AdsQuery.escape(campaign)}"
        return read(path, AdsAdsetsInfo)
    }

    override suspend fun makeAdsets(design: Map<String, Any?>): AdsDesignMade = read("/api/ads/adsets", AdsDesignMade, "POST", mapOf("design" to design), 130_000)

    override suspend fun media(after: String?): AdsMediaAnswer =
        read("/api/ads/media" + (after?.let { "?after=${AdsQuery.escape(it)}" } ?: ""), AdsMediaAnswer)

    override suspend fun library(after: String?): AdsLibraryAnswer =
        read("/api/ads/library" + (after?.let { "?after=${AdsQuery.escape(it)}" } ?: ""), AdsLibraryAnswer)

    /** A website piece's photo into the ad account's library: the server fetches it from the house's own site. */
    override suspend fun imageFromPiece(pieceId: String): AdsImageAnswer = read("/api/ads/images", AdsImageAnswer, "POST", mapOf("pieceId" to pieceId))

    override suspend fun preview(plan: Map<String, Any?>): List<AdsPreview> {
        val text = api.data("/api/ads/preview", "POST", mapOf("plan" to plan))
        return AdsPreview.list(Json.parse(text))
    }

    override suspend fun template(ad: String): AdsTemplate = read("/api/ads/template?ad=${AdsQuery.escape(ad)}", AdsTemplate)

    override suspend fun sitePieces(): List<AdsSitePiece> {
        val text = api.data("/api/website/site-pieces")
        val m = Json.parse(text) as? Map<*, *> ?: return emptyList()
        return Container(mapOf("pieces" to m["pieces"])).list("pieces", AdsSitePiece).filter { it.id.isNotEmpty() }
    }

    override suspend fun upload(jpeg: ByteArray): AdsImageAnswer = AdsUpload.send(jpeg)

    override suspend fun places(q: String): List<AdsPlace> {
        val m = Json.parse(api.data("/api/ads/search?type=place&q=${AdsQuery.escape(q)}")) as? Map<*, *> ?: return emptyList()
        return Container(mapOf("r" to m["results"])).list("r", AdsPlace).filter { it.key.isNotEmpty() }
    }

    override suspend fun interests(q: String): List<AdsInterestHit> {
        val m = Json.parse(api.data("/api/ads/search?type=interest&q=${AdsQuery.escape(q)}")) as? Map<*, *> ?: return emptyList()
        return Container(mapOf("r" to m["results"])).list("r", AdsInterestHit).filter { it.id.isNotEmpty() }
    }

    override suspend fun suggestions(names: List<String>): List<AdsInterestHit> {
        val list = AdsQuery.escape(names.joinToString(","))
        val m = Json.parse(api.data("/api/ads/search?type=suggest&names=$list")) as? Map<*, *> ?: return emptyList()
        return Container(mapOf("r" to m["results"])).list("r", AdsInterestHit).filter { it.id.isNotEmpty() }
    }

    override suspend fun estimate(draft: AdsAudience, goal: String): AdsEstimate =
        read("/api/ads/estimate", AdsEstimate, "POST", mapOf("draft" to draft.json, "goal" to goal))

    override suspend fun audiences(): AdsAudiencesAnswer = read("/api/ads/audiences", AdsAudiencesAnswer)

    override suspend fun makeAudience(body: Map<String, Any?>): AdsAudienceMade = read("/api/ads/audiences", AdsAudienceMade, "POST", body, 130_000)

    override suspend fun deleteAudience(id: String) {
        api.send("/api/ads/audiences?id=${AdsQuery.escape(id)}", "DELETE")
    }

    override suspend fun rules(): AdsRulesAnswer = read("/api/ads/rules", AdsRulesAnswer)

    override suspend fun makeRule(kind: String, amount: Double) {
        api.send("/api/ads/rules", body = mapOf("kind" to kind, "amount" to amount))
    }

    override suspend fun setRule(id: String, enabled: Boolean) {
        api.send("/api/ads/rules", body = mapOf("id" to id, "enabled" to enabled))
    }

    override suspend fun deleteRule(id: String) {
        api.send("/api/ads/rules?id=${AdsQuery.escape(id)}", "DELETE")
    }

    override suspend fun setupAssets(): AdsSetupAssets = read("/api/ads/setup", AdsSetupAssets)

    /** Saves part of this house's settings (the ad account, Page, Instagram, greeting, login configuration). */
    override suspend fun saveSetup(patch: Map<String, Any?>): AdsSettingsRow? = read("/api/ads/setup", AdsSettingsSaved, "POST", patch).settings

    override suspend fun disconnect() {
        api.send("/api/ads/setup", body = mapOf("action" to "disconnect"))
    }

    override suspend fun pixel(): AdsPixelAnswer = read("/api/ads/pixel", AdsPixelAnswer)

    /** Choose a pixel (null: stop using one) or make a new one ("create"). */
    override suspend fun pixelAct(body: Map<String, Any?>) {
        api.send("/api/ads/pixel", body = body)
    }

    override suspend fun objectDetail(id: String, level: String): Map<String, Any?> {
        @Suppress("UNCHECKED_CAST")
        return (Json.parse(api.data("/api/ads/object/${AdsQuery.escape(id)}?level=$level")) as? Map<String, Any?>) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
    }

    override suspend fun objectAct(id: String, level: String, action: String, fields: Map<String, Any?>) {
        val body = LinkedHashMap(fields)
        body["action"] = action
        body["level"] = level
        api.send("/api/ads/object/${AdsQuery.escape(id)}", body = body)
    }
}

/**
 * A photo from this phone into the ad account's picture library, through the web's own route (/api/ads/images, a form
 * with `file`; the server makes it a JPEG of at most 2048 px and hands it to Meta, which answers with the hash the ad
 * names). ErpApi sends JSON only, so this one form post is made here under its own guards: the house's ERP over https
 * and nowhere else, the sign-in token, no redirect off the host, no cache.
 * TODO(shared): ErpApi.upload when the shell gains a multipart call.
 */
object AdsUpload {
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .cache(null)
            .followRedirects(true)
            .followSslRedirects(false)
            .addNetworkInterceptor { chain ->
                val u = chain.request().url
                if (u.scheme != "https" || u.host != House.serverUrl.toHttpUrl().host) throw IOException("Redirected away from the ERP.")
                chain.proceed(chain.request())
            }
            .connectTimeout(20, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build()
    }

    suspend fun send(jpeg: ByteArray): AdsImageAnswer {
        if (House.isDemo || !ErpApp.firebaseReady) throw ErpApi.Failure(0, "Not connected to the ERP in the demo.")
        val url = ErpApi.resolve(House.serverUrl, "/api/ads/images") ?: throw ErpApi.Failure(0, "Not an address of this ERP.")
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", "photo.jpg", jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()
        val builder = Request.Builder().url(url).header("Accept", "application/json").post(body)
        val token = try {
            FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token
        } catch (e: Exception) {
            null
        }
        if (token != null) builder.header("Authorization", "Bearer $token")
        val response = try {
            client.newCall(builder.build()).await()
        } catch (e: IOException) {
            throw ErpApi.Failure(0, e.message?.takeIf { it.isNotBlank() } ?: "No connection to the ERP.")
        }
        response.use { r ->
            val text = r.body.string()
            if (r.code !in 200..299) throw ErpApi.Failure(r.code, ErpApi.said(text) ?: "The ERP answered ${r.code}.")
            val answer = AdsImageAnswer.from(Json.parse(text)) ?: throw ErpApi.Failure(r.code, "The ERP's answer couldn't be read.")
            if (answer.hash.isEmpty()) throw ErpApi.Failure(r.code, "Meta took the photo but gave no reference for it.")
            return answer
        }
    }

    private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { runCatching { cancel() } }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWith(Result.failure(e)) }
            override fun onResponse(call: Call, response: Response) { if (cont.isActive) cont.resumeWith(Result.success(response)) else response.close() }
        })
    }
}

// MARK: What the pages keep between visits

/** The range as a menu in the bar (the web's chip row), remembered on the phone and shared by Overview and Campaigns. */
object AdsRangeStore {
    private const val KEY = "ads.range"
    var key by mutableStateOf(Prefs.string(KEY) ?: "last_7d")
        private set

    fun set(k: String) {
        key = k
        Prefs.putString(KEY, k)
    }
}

/**
 * A change made on one Ads page (a budget, a pause, an archive) the pages under it should show: the iPhone reads the
 * tree again when a pushed page goes back; here the pages watch this count.
 */
object AdsChanges {
    val count = MutableStateFlow(0)

    fun bump() {
        count.value = count.value + 1
    }
}

/**
 * The last audience, budget and goal, on this phone (the web keeps them per device too: `taheri_ads_last`).
 */
class AdsLastChoice(
    val audience: AdsAudience?,
    val amount: Double?,
    val budgetKind: String?,
    /** Present: the days chosen, null for "until I stop it". Absent: never chosen. */
    val hasDays: Boolean,
    val days: Int?,
    val goal: String?,
) {
    companion object {
        private const val KEY = "ads.newAd.last"

        fun read(): AdsLastChoice? {
            val text = Prefs.string(KEY) ?: return null
            @Suppress("UNCHECKED_CAST")
            val m = Json.parse(text) as? Map<String, Any?> ?: return null
            val c = Container(m)
            return AdsLastChoice(
                c.obj("audience", AdsAudience), c.double("amount"), c.string("budgetKind"), m.containsKey("days"), c.int("days"), c.string("goal"),
            )
        }

        fun keep(audience: AdsAudience, amount: Double, budgetKind: String, days: Int?, goal: String) {
            val o = linkedMapOf<String, Any?>("audience" to audience.json, "amount" to amount, "budgetKind" to budgetKind, "days" to days, "goal" to goal)
            Prefs.putString(KEY, JsonText.of(o) ?: return)
        }
    }
}

/**
 * Studio's hand-off to New ad (`?studio=<key>`): the photos, words and goal a designed ad carries over.
 * TODO(shared): StudioHandoffs.shared.ads, when Studio is native here it fills this.
 */
object AdsStudioHandoffs {
    val ads = HashMap<String, Map<String, Any?>>()
}
