package erp.app.screens.ads

import erp.app.data.ErpApi
import erp.core.Container
import erp.core.Decodable
import erp.core.logic.ShopNumber
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

// New ad's other sources and its folded-away bidding (AdsNewAdSources.swift, 2026-10-16: the web's "Add all the other
// features"): a new video, a creator's post as a partnership ad, the catalogue (Advantage+ catalogue ads), and Ads
// Manager's bid strategy and "run ads on a schedule". As everywhere in New ad, the phone only gathers the choices: the
// server says what stops the plan (/api/ads/plan → planProblems) and builds what Meta is sent (plan.ts creativeSpec).
// Plain data and the upload's logic, so the JSON the routes take is tested on the JVM key for key.

// MARK: A new video

/** Where a video is on its way to Meta. */
data class AdsVideoDraft(
    val name: String,
    val phase: Phase = Phase.sending,
    /** How much of the file has gone, 0…1. */
    val sent: Double = 0.0,
    val videoId: String = "",
    val thumbHash: String = "",
    val thumb: String? = null,
    val error: String? = null,
) {
    enum class Phase { sending, processing, ready, failed }

    val busy: Boolean get() = phase == Phase.sending || phase == Phase.processing

    /** plan.ts `{ kind: 'video', videoId, thumbHash, thumb, name }`; the hash is empty until Meta has the cover. */
    val json: Map<String, Any?>
        get() = linkedMapOf("kind" to "video", "videoId" to videoId, "thumbHash" to if (phase == Phase.ready) thumbHash else "", "thumb" to thumb, "name" to name)
}

/** The upload Meta opened: the session, the video's id and the first piece it wants. */
data class AdsVideoStarted(val session: String, val videoId: String, val start: Int, val end: Int) {
    companion object : Decodable<AdsVideoStarted> {
        override fun fromMap(m: Map<String, Any?>): AdsVideoStarted {
            val c = Container(m)
            return AdsVideoStarted(c.string("session", ""), c.string("videoId", ""), c.int("start") ?: 0, c.int("end") ?: 0)
        }
    }
}

/** The next piece Meta asks for; start == end when it has the whole file. */
data class AdsVideoRange(val start: Int, val end: Int) {
    companion object : Decodable<AdsVideoRange> {
        override fun fromMap(m: Map<String, Any?>): AdsVideoRange {
            val c = Container(m)
            return AdsVideoRange(c.int("start") ?: 0, c.int("end") ?: 0)
        }
    }
}

/** Meta's processing: "processing", "ready" (with the cover frame's hash) or "error". */
data class AdsVideoStatus(val status: String, val thumbHash: String, val thumb: String?, val detail: String?) {
    companion object : Decodable<AdsVideoStatus> {
        override fun fromMap(m: Map<String, Any?>): AdsVideoStatus {
            val c = Container(m)
            return AdsVideoStatus(c.string("status", "processing"), c.string("thumbHash", ""), c.string("thumb"), c.string("detail"))
        }
    }
}

/** A video file read in pieces from wherever the phone keeps it (a content address): the size, and any range of it. */
interface AdsVideoSource {
    val size: Long
    fun read(start: Long, length: Int): ByteArray
}

/**
 * /api/ads/videos: Meta's resumable upload, a piece per request (the server's request limit holds for any size), then
 * Meta's processing, then its cover frame put in the image library (a video ad needs a cover). `pause` is the wait
 * between tries and polls (a test passes none).
 */
object AdsVideoUpload {
    suspend fun send(
        source: AdsVideoSource,
        name: String,
        backend: AdsBackend,
        progress: (AdsVideoDraft) -> Unit,
        pause: suspend (Long) -> Unit = { delay(it) },
    ) {
        var d = AdsVideoDraft(name)
        try {
            val size = source.size
            if (size <= 0) throw ErpApi.Failure(0, "That video is empty.")
            val s = backend.videoStart(size.toInt())
            if (s.session.isEmpty() || s.videoId.isEmpty()) throw ErpApi.Failure(0, "Meta didn't open the upload.")
            var start = s.start
            var end = s.end
            while (start < end) {
                val chunk = source.read(start.toLong(), end - start)
                var next: AdsVideoRange? = null
                var tries = 0
                while (next == null) {
                    try {
                        next = backend.videoPiece(s.session, start, chunk)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        tries += 1
                        if (tries >= 3) throw e
                        pause(2000L * tries)
                    }
                }
                start = next.start
                end = next.end
                d = d.copy(sent = minOf(1.0, start.toDouble() / size))
                progress(d)
            }
            backend.videoFinish(s.session, name)
            d = d.copy(phase = AdsVideoDraft.Phase.processing, videoId = s.videoId)
            progress(d)
            repeat(150) {
                pause(4000)
                val st = backend.videoStatus(s.videoId)
                if (st.status == "ready" && st.thumbHash.isNotEmpty()) {
                    progress(d.copy(phase = AdsVideoDraft.Phase.ready, thumbHash = st.thumbHash, thumb = st.thumb))
                    return
                }
                if (st.status == "error") {
                    throw ErpApi.Failure(0, "Meta couldn't process the video (${st.detail ?: "error"}). Try exporting it as an MP4.")
                }
            }
            throw ErpApi.Failure(0, "Meta is still processing the video. Try again in a few minutes.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            progress(d.copy(phase = AdsVideoDraft.Phase.failed, error = e.message ?: "It didn't reach Meta."))
        }
    }
}

// MARK: A creator's post

/** /api/ads/partner: a creator's partnership ad code, checked with Meta before it goes into an ad. */
data class AdsPartnerCheck(
    val code: String = "",
    val ok: Boolean,
    val mediaId: String?,
    val creator: String?,
    val permalink: String?,
    val thumb: String?,
    val why: String?,
) {
    companion object : Decodable<AdsPartnerCheck> {
        override fun fromMap(m: Map<String, Any?>): AdsPartnerCheck {
            val c = Container(m)
            return AdsPartnerCheck("", c.bool("ok", false), c.string("mediaId"), c.string("creator"), c.string("permalink"), c.string("thumb"), c.string("why"))
        }

        /** What a check that could not be made says: the code stays, with the reason. */
        fun failed(code: String, why: String) = AdsPartnerCheck(code, false, null, null, null, null, why)

        /** Checks a code; the answer carries the code it was for, so a changed code reads as unchecked. */
        suspend fun check(backend: AdsBackend, code: String): AdsPartnerCheck = try {
            backend.partnerCheck(code).copy(code = code)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failed(code, adsWords(e))
        }
    }
}

// MARK: The catalogue

/** A catalogue or one of its product sets (/api/ads/catalog). */
data class AdsCatalogRow(val id: String, val name: String, val products: Int?) {
    val words: String get() = products?.let { "$name · $it pieces" } ?: name

    companion object : Decodable<AdsCatalogRow> {
        override fun fromMap(m: Map<String, Any?>): AdsCatalogRow {
            val c = Container(m)
            return AdsCatalogRow(c.string("id", ""), c.string("name", ""), c.int("products"))
        }
    }
}

data class AdsCatalogsAnswer(val catalogs: List<AdsCatalogRow>, val sets: List<AdsCatalogRow>) {
    companion object : Decodable<AdsCatalogsAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsCatalogsAnswer {
            val c = Container(m)
            return AdsCatalogsAnswer(
                c.list("catalogs", AdsCatalogRow).filter { it.id.isNotEmpty() },
                c.list("sets", AdsCatalogRow).filter { it.id.isNotEmpty() },
            )
        }
    }
}

/** The catalogue choice: which catalogue, which set (biggest first, as the server sorts them), and who it finds. */
data class AdsCatalogChoice(
    val catalogs: List<AdsCatalogRow>? = null,
    val catalogId: String = "",
    val sets: List<AdsCatalogRow>? = null,
    val setId: String = "",
    /** `viewers`: lookers and carters of the last 14 days who didn't buy; `everyone`: new buyers. */
    val who: String = "viewers",
    val problem: String? = null,
) {
    /** plan.ts `{ kind: 'catalog', catalogId, setId, setName, who }`. */
    val json: Map<String, Any?>
        get() {
            val j = linkedMapOf<String, Any?>("kind" to "catalog", "catalogId" to catalogId, "setId" to setId, "who" to who)
            sets?.firstOrNull { it.id == setId }?.let { j["setName"] = it.name }
            return j
        }
}

// MARK: Bidding and hours

/** Ads Manager's bid strategy and "run ads on a schedule" (plan.ts Bidding, AdHours), folded away by default. */
data class AdsAdvanced(
    val open: Boolean = false,
    /** lowest, cost_cap, bid_cap or min_roas. */
    val bid: String = "lowest",
    val amount: String = "",
    val roas: String = "3",
    val hoursOn: Boolean = false,
    /** 0 = Sunday … 6 = Saturday. */
    val days: Set<Int> = (0..6).toSet(),
    val from: Int = 10,
    val to: Int = 23,
) {
    val bidding: Map<String, Any?>
        get() = when (bid) {
            "cost_cap", "bid_cap" -> linkedMapOf("kind" to bid, "amount" to (AdsAmount.parse(amount) ?: 0.0))
            "min_roas" -> linkedMapOf("kind" to "min_roas", "roas" to (ShopNumber.parse(roas) ?: 0.0))
            else -> linkedMapOf("kind" to "lowest")
        }

    /** Minutes from midnight in the viewer's own time, as plan.ts AdHours; null when the ad runs all day. */
    val hours: Map<String, Any?>?
        get() = if (!hoursOn) null else linkedMapOf("days" to days.sorted(), "from" to from * 60, "to" to to * 60)

    val isSet: Boolean get() = bid != "lowest" || hoursOn

    /** The line under the open section, for the bid and the hours chosen. */
    val note: String
        get() {
            val lines = ArrayList<String>()
            lines.add(
                when (bid) {
                    "cost_cap" -> "Meta keeps the average cost per result near your figure; it may spend less of the budget."
                    "bid_cap" -> "A hard ceiling on each auction bid; for people who know their numbers."
                    "min_roas" -> "Meta aims for purchases worth at least this many times what it spends, and optimises for order value."
                    else -> "Meta spends the budget for as many results as it can (the usual choice)."
                },
            )
            if (hoursOn) lines.add("Hours are each viewer's own time; Meta runs set hours only with a total budget.")
            return lines.joinToString(" ")
        }
}
