package erp.app.screens.design

import erp.app.data.ErpApi
import erp.app.screens.marketing.MarketingPhotos
import erp.app.screens.marketing.MarketingRequest
import erp.app.screens.marketing.MarketingValue
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext

// The AI picture tools in the workspace's photograph card (DesignAI.swift; src/app/design/{ai-tools,design-piece}.tsx). Nothing new
// server-side: every tool calls the route it always called, through the app's own sender (MarketingRequest.ai, the one Post a piece uses):
//   Enhance · Logo and labels off · Extend to this shape · Retouch · New setting… · Ask AI…  POST /api/website/post/ai  op enhance |
//        reframe | retouch | restage | custom, the photograph at most 2048 px; every result comes back with a same-piece check.
//   Remove background  POST /api/design/remove-background (Magnific; a PNG with alpha, no pixel redrawn, so no check)
//   Flat image → layers  POST /api/design/layers (owner and marketing)
//   Make the ad with AI  POST /api/ads/studio/auto op direct (owner and marketing, an ad), as the Studio's "Make it with AI"
// One tool at a time (the Vertex quota is tiny); a result the check doubts waits for a look instead of going in unseen.

sealed interface DesignPhotoOp {
    data object Enhance : DesignPhotoOp
    data object Clean : DesignPhotoOp
    data object Extend : DesignPhotoOp
    data object Retouch : DesignPhotoOp
    class Setting(val sceneId: String?, val scene: String?, val aspect: String) : DesignPhotoOp
    class Ask(val instruction: String, val aspect: String?) : DesignPhotoOp
}

object DesignAIRules {
    /** ai-tools.tsx checkOk: the same piece, and sure enough. */
    fun checkOK(check: MarketingValue?): Boolean {
        if (check == null || check.isNull) return false
        return check["samePiece"].bool && (if (check["confidence"].isNull) 1.0 else check.n("confidence")) >= 0.8
    }

    /** What the ad's goal sends people to, as the art director is told it (lib/ads/plan.ts GOALS `hint`). */
    val goalHints: Map<String, String> = mapOf(
        "whatsapp" to "People tap and start a WhatsApp chat with the shop.",
        "messages" to "Each person gets the app they use — WhatsApp or Instagram Direct.",
        "instagram_dm" to "People tap and message the shop on Instagram.",
        "website" to "People tap through to the piece on the website.",
        "sales" to "Meta looks for people who buy on the website — needs its pixel recording orders.",
        "channel" to "People tap through to the shop’s WhatsApp channel and follow it.",
        "profile" to "People tap through to the shop’s Instagram profile.",
        "engagement" to "More people engage with the post itself.",
        "reach" to "As many different people as the budget allows.",
    )

    val askIdeas = listOf(
        "Remove the hand and props", "Warmer, golden-hour light", "Deep green velvet background",
        "Soft bokeh lights behind", "Clean white studio background", "Add a subtle reflection below",
    )
}

/** lib/ads/studio/templates.ts nearestAiRatio: the AI's own shapes, the nearest to a frame. */
object DesignAspect {
    val ratios = listOf("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")

    fun nearest(w: Double, h: Double): String {
        var best = "1:1"
        var diff = Double.POSITIVE_INFINITY
        for (r in ratios) {
            val p = r.split(":").mapNotNull { it.toDoubleOrNull() }
            if (p.size != 2 || h <= 0 || w <= 0) continue
            val d = abs(ln((p[0] / p[1]) / (w / h)))
            if (d < diff) { diff = d; best = r }
        }
        return best
    }
}

/** A photograph as the AI is sent it: at most 2048 px on the long side. */
private fun forAI(data: ByteArray): ByteArray = MarketingPhotos.jpegCopy(data, 2048) ?: data

/** One tool at a time: nothing starts while another runs. */
private suspend fun DesignWorkspaceModel.guarded(what: String, work: suspend () -> Unit) {
    if (aiBusy != null) return
    aiBusy = what
    try { work() } finally { aiBusy = null }
}

private fun DesignWorkspaceModel.explain(e: Throwable) {
    val status = (e as? ErpApi.Failure)?.status ?: 0
    val hint = if (status == 429) "The AI limit for now is reached. Try again in a few minutes." else (e.message ?: "")
    say("The AI couldn’t do that", hint, failed = true)
}

private fun decodeB64(text: String): ByteArray? = try { java.util.Base64.getMimeDecoder().decode(text) } catch (e: IllegalArgumentException) { null }

/** The photograph's tools (ai-tools.tsx `photo`). */
suspend fun DesignWorkspaceModel.photoTool(op: DesignPhotoOp) {
    val w = work ?: return
    val source = photos["photo"] ?: return
    val page = w.activePage
    val aspect = DesignAspect.nearest(page.w, page.h)
    val label: String
    val wait: String
    val clean: Boolean
    when (op) {
        DesignPhotoOp.Enhance -> { label = "Enhanced"; wait = "Enhancing the photograph, about a minute"; clean = tidy }
        DesignPhotoOp.Clean -> { label = "Logo and labels off"; wait = "Taking the logo and labels off, about a minute"; clean = true }
        DesignPhotoOp.Extend -> { label = "Extended $aspect"; wait = "Extending the photograph, about a minute"; clean = true }
        DesignPhotoOp.Retouch -> { label = "Retouched"; wait = "Retouching: piece, background and light, about two minutes"; clean = tidy }
        is DesignPhotoOp.Setting -> {
            val known = catalogue["scenes"].array.firstOrNull { it.s("id") == op.sceneId }?.s("label")
            label = if (op.scene != null) "New setting" else (known ?: "New setting")
            wait = "Photographing it in the new setting, about a minute"; clean = true
        }
        is DesignPhotoOp.Ask -> {
            val head = op.instruction.take(28)
            label = head.ifEmpty { "Your edit" }; wait = "Doing what you asked, about a minute"; clean = false
        }
    }
    guarded(wait) {
        try {
            val image = withContext(Dispatchers.Default) { forAI(source) }
            val r: MarketingValue = when (op) {
                DesignPhotoOp.Enhance -> MarketingRequest.ai("enhance", listOf(image), mapOf("tidy" to tidy))
                DesignPhotoOp.Clean -> MarketingRequest.ai("enhance", listOf(image), mapOf("tidy" to true))
                DesignPhotoOp.Extend -> MarketingRequest.ai("reframe", listOf(image), mapOf("aspect" to aspect, "tidy" to (marked || tidy)))
                DesignPhotoOp.Retouch -> MarketingRequest.ai("retouch", listOf(image), mapOf("tidy" to tidy))
                is DesignPhotoOp.Setting -> {
                    val p = linkedMapOf<String, Any?>("aspect" to op.aspect)
                    if (!op.scene.isNullOrEmpty()) p["scene"] = op.scene else if (op.sceneId != null) p["sceneId"] = op.sceneId
                    MarketingRequest.ai("restage", listOf(image), p)
                }
                is DesignPhotoOp.Ask -> {
                    val p = linkedMapOf<String, Any?>("instruction" to op.instruction.trim())
                    if (op.aspect != null) p["aspect"] = op.aspect
                    MarketingRequest.ai("custom", listOf(image), p)
                }
            }
            val data = decodeB64(r["image"].s("data"))
            if (data == null || withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(data) } == null) throw ErpApi.Failure(0, "The AI sent no image back.")
            val check = r["check"].takeUnless { it.isNull }
            if (check != null && !DesignAIRules.checkOK(check)) {
                candidate = DesignCandidate(data, label, clean, check)
                say("Check this one before it goes in", check["differences"].array.firstOrNull()?.string ?: "The AI may have changed the piece.", failed = true)
                return@guarded
            }
            takeAIPhoto(data, check, clean)
            say("$label: done", if (check != null) "The check: the same piece as before." else "Not checked: compare it with the original.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            explain(e)
        }
    }
}

/**
 * Make the ad with AI (ai-tools.tsx `makeAd`, the Studio's "Make it with AI", /api/ads/studio/auto op `direct`): an art director's
 * layout and words from the photograph and its details, the logo off and the photo extended when the shape needs it, then the same
 * layout on every size. A prepared photo the check doubts is not used: the words and layout go in on the photograph as it was.
 */
suspend fun DesignWorkspaceModel.makeAd(brief: String) {
    val w = work ?: return
    if (w.kind != "ad") return
    val source = photos["photo"] ?: return
    val size = erp.app.screens.marketing.ArtworkPixels.size(source) ?: return
    if (size.second <= 0) return
    val page = w.activePage
    val aspect = DesignAspect.nearest(page.w, page.h)
    val format = catalogue["formats"].array.firstOrNull { it.s("id") == page.format } ?: MarketingValue.NULL
    val params = linkedMapOf<String, Any?>(
        "name" to (if (w.name.isEmpty()) (w.fields["headline"] ?: "") else w.name), "collection" to "", "specs" to (w.fields["weight"] ?: ""),
        "price" to (w.copy["price"] ?: ""), "brief" to brief, "format" to page.format, "aspect" to aspect,
        "shape" to format.s("label", page.label), "trimTo" to format.s("short"),
        "destination" to (DesignAIRules.goalHints[w.copy["goal"] ?: "whatsapp"] ?: "a WhatsApp chat with the shop"),
        "kicker" to (w.fields["kicker"] ?: ""), "headline" to (w.fields["headline"] ?: ""), "cta" to (w.fields["details"] ?: ""),
    )
    val ratio = (size.first / size.second) / (page.w / max(1.0, page.h))
    val extend = ratio > 1.3 || ratio < 0.77
    val isMarked = marked
    guarded("Designing the ad from the photo and its details, about a minute") {
        try {
            val picture = withContext(Dispatchers.Default) { forAI(source) }
            coroutineScope {
                // The photograph is prepared beside the direction, as the web does: extended to the shape, or its marks taken off.
                val prepared = async {
                    runCatching {
                        if (extend) MarketingRequest.ai("reframe", listOf(picture), mapOf("aspect" to aspect, "tidy" to isMarked))
                        else if (isMarked) MarketingRequest.ai("enhance", listOf(picture), mapOf("tidy" to true))
                        else null
                    }.getOrNull()
                }
                val text = ErpApi.shared.upload(
                    "/api/ads/studio/auto", listOf("op" to "direct", "params" to MarketingValue.of(params).text),
                    listOf(ErpApi.FormFile("image", "photo.jpg", "image/jpeg", picture)), timeoutMs = 300_000,
                )
                val d = MarketingValue.parse(text)["direction"]
                val fixed = prepared.await()
                val next = LinkedHashMap(w.fields)
                for ((key, from) in listOf("kicker" to "kicker", "headline" to "headline", "details" to "cta")) if (d.s(from).isNotEmpty()) next[key] = d.s(from)
                for ((k, v) in next) if (v != w.fields[k]) setField(k, v)
                d["primaryText"].array.firstOrNull()?.string?.takeIf { it.isNotEmpty() }?.let { setCopy("adText", it) }
                d["adHeadlines"].array.firstOrNull()?.string?.takeIf { it.isNotEmpty() }?.let { setCopy("adHeadline", it) }
                // The photograph's "same piece?" check decides: a result that changed the piece never goes into an ad unseen.
                val check = fixed?.get("check")?.takeUnless { it.isNull }
                val changed = check?.let { !it["samePiece"].bool } ?: false
                if (fixed != null && !changed) {
                    val data = decodeB64(fixed["image"].s("data"))
                    if (data != null && withContext(Dispatchers.Default) { MarketingPhotos.jpegCopy(data) } != null) takeAIPhoto(data, check, true)
                }
                // The same layout on every size of the design, each from a blank page that keeps its photograph's placement.
                val layout = d.s("layout").ifEmpty { page.doc["meta"].s("template") }
                val now = work
                if (layout.isNotEmpty() && now != null) {
                    for (p in now.pages) {
                        var doc = DesignWork.blankDoc(p.w, p.h)
                        if (!p.doc["bg"]["placement"].isNull) doc = doc.withPath(listOf("bg", "placement"), p.doc["bg"]["placement"])
                        setDoc(p.id, layOut(p.copy(doc = doc), layout, now.fields))
                    }
                }
                if (changed) {
                    say("Kept your photo", "The AI changed the piece: ${(check?.get("differences")?.array?.take(2)?.map { it.string } ?: emptyList()).joinToString("; ")}. The words and layout are in.", failed = true)
                } else {
                    val scene = catalogue["scenes"].array.firstOrNull { it.s("id") == d.s("scene") }?.s("label")
                    say("The ad is made", listOf(d.s("why"), scene?.let { "A new setting would suit it: $it (New setting…)." } ?: "").filter { it.isNotEmpty() }.joinToString(" "))
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            explain(e)
        }
    }
}

/** "Use it" on a picture that waited for a look. */
suspend fun DesignWorkspaceModel.useCandidate() {
    val c = candidate ?: return
    candidate = null
    takeAIPhoto(c.data, c.check, c.clean)
}

/**
 * Remove background (design-piece.tsx cutOut): the piece laid on this page as a picture layer over the house's ground, where the
 * photograph was. Nothing is drawn by the AI; the photograph itself is kept (lay the page out again to see it).
 */
suspend fun DesignWorkspaceModel.cutOut() {
    val w = work ?: return
    val source = photos["photo"] ?: return
    val size = erp.app.screens.marketing.ArtworkPixels.size(source) ?: return
    if (size.second <= 0) return
    val page = w.activePage
    guarded("Cutting the piece out, about ten seconds") {
        try {
            val png = ErpApi.shared.uploadBytes(
                "/api/design/remove-background", emptyList(),
                listOf(ErpApi.FormFile("file", "photo.jpg", "image/jpeg", withContext(Dispatchers.Default) { forAI(source) })), timeoutMs = 100_000,
            )
            if (erp.app.screens.marketing.ArtworkPixels.size(png) == null) throw ErpApi.Failure(0, "The cut-out didn’t come.")
            val placement = page.doc["bg"]["placement"]
            val ar = size.first / size.second
            val zoom = placement.n("zoom", 1.0)
            val cover = max(page.w, page.h * ar) * (if (placement.s("mode") == "fit") 1.0 else max(1.0, if (zoom == 0.0) 1.0 else zoom))
            val dw = cover
            val dh = cover / ar
            val fx = if (placement["focusX"].isNull) 0.5 else placement.n("focusX")
            val fy = if (placement["focusY"].isNull) 0.5 else placement.n("focusY")
            val layer = MarketingValue.of(
                mapOf(
                    "id" to "image-cut" + java.lang.Long.toString(System.currentTimeMillis(), 36), "kind" to "image", "role" to "photo", "photoId" to "cutout",
                    "src" to "data:image/png;base64," + java.util.Base64.getEncoder().encodeToString(png),
                    "x" to Math.round((page.w - dw) * fx), "y" to Math.round((page.h - dh) * fy), "w" to Math.round(dw), "h" to Math.round(dh),
                    "radius" to 0, "border" to null, "shadow" to false, "rotate" to 0, "opacity" to 1, "cutout" to true, "name" to "Piece",
                ),
            )
            var doc = page.doc.withPath(listOf("bg", "photoId"), MarketingValue.NULL)
            doc = doc.with("layers", MarketingValue.array(listOf(layer) + doc["layers"].array))
            setDoc(page.id, doc)
            say("Background removed", "The piece is a layer on the house’s ground. No part of it was redrawn.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say("The background wasn’t removed", e.message ?: "", failed = true)
        }
    }
}

/** Flat image → layers (owner and marketing): the photograph read once, then reviewed before a design is started from it. */
suspend fun DesignWorkspaceModel.splitLayers() {
    val source = photos["photo"] ?: return
    guarded("Splitting into layers, about a minute") {
        try {
            val text = ErpApi.shared.upload(
                "/api/design/layers", emptyList(),
                listOf(ErpApi.FormFile("file", "photo.jpg", "image/jpeg", withContext(Dispatchers.Default) { forAI(source) })), timeoutMs = 110_000,
            )
            val plan = MarketingValue.parse(text)
            val model = this
            sheet = DesignSheet("Layers") { dismiss -> DesignLayersSheet(model, plan, source, dismiss) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            say("It couldn’t be split", e.message ?: "", failed = true)
        }
    }
}

// MARK: Flat image → layers (flat-ad.ts)

object DesignLayerPlan {
    /** The design a reviewed plan starts: the cut-out piece on the picture's own edge colour, the lettering it found as text layers. */
    fun request(plan: MarketingValue, photo: ByteArray, rawName: String, keep: Set<String>): DesignStartRequest {
        val width = max(1.0, plan.n("width", 1080.0))
        val height = max(1.0, plan.n("height", 1080.0))
        val h = max(1, minOf(100, Math.round(100 / (width / height)).toInt()))
        val kept = plan["layers"].array.filter { it.s("id") in keep }
        val cutout: String? = if (!plan["cutout"].isNull && plan["cutout"].s("data").isNotEmpty()) "data:${plan["cutout"].s("mimeType", "image/png")};base64,${plan["cutout"].s("data")}" else null
        val ground = if (cutout == null) null else DesignSmartModel.edgeColour(photo)
        val headline = kept.firstOrNull { it.s("role") == "headline" }?.s("text") ?: ""
        val subject = plan["subject"]
        val name = rawName.replace(Regex("\\.[A-Za-z0-9]+$"), "")
        return DesignStartRequest(
            kind = "custom", sizes = listOf(DesignSizeChoice("custom", 100, h)),
            photo = DesignStartPhoto(name.ifEmpty { "Picture" }, { photo }), fields = if (headline.isEmpty()) emptyMap() else mapOf("headline" to headline),
            compose = { page ->
                var doc = DesignWork.blankDoc(page.w, page.h)
                val k = page.w / width
                val layers = ArrayList<MarketingValue>()
                if (cutout != null) {
                    layers.add(
                        MarketingValue.of(
                            mapOf(
                                "id" to "image-cutout", "kind" to "image", "role" to "photo", "photoId" to "cutout", "src" to cutout, "x" to 0, "y" to 0, "w" to page.w, "h" to page.h,
                                "radius" to 0, "border" to null, "shadow" to false, "rotate" to 0, "opacity" to 1, "cutout" to true, "name" to "Piece",
                            ),
                        ),
                    )
                }
                for (l in kept) {
                    var t = l
                    t = t.with("x", MarketingValue.number(Math.round(l.n("x") * k).toDouble()))
                    t = t.with("y", MarketingValue.number(Math.round(l.n("y") * k).toDouble()))
                    t = t.with("size", MarketingValue.number(max(12.0, Math.round(l.n("size") * k).toDouble())))
                    if (l.n("width") > 0) t = t.with("width", MarketingValue.number(Math.round(l.n("width") * k).toDouble()))
                    layers.add(t)
                }
                if (cutout != null) {
                    doc = doc.withPath(listOf("bg", "photoId"), MarketingValue.NULL).withPath(listOf("bg", "color"), MarketingValue.string(ground ?: "#1B1B1B"))
                }
                doc = doc.with("layers", MarketingValue.array(layers))
                doc.with("meta", if (subject.isNull) MarketingValue.of(emptyMap<String, Any>()) else MarketingValue.of(mapOf("subject" to subject)))
            },
        )
    }
}
