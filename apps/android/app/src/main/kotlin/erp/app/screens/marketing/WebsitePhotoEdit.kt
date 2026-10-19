package erp.app.screens.marketing

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import erp.app.config.House
import erp.app.data.ErpApi
import erp.core.swiftRounded
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext

/**
 * Edit a piece's photograph, re-made on the phone as edit/page.tsx `PieceEditor` re-makes it (WebsiteEditPhoto.swift): always
 * from the photo as the site built it (`site-pieces/image?original=1&size=3000`), the last design kept on the ERP
 * (`/api/website/edits` `design`) so a piece re-opens as it was left and a stamp never goes on twice, its own shape or square,
 * the layouts that stamp the weight and the house's mark (site-design.ts `siteLayouts`, through the bundled engine), the
 * designer, and AI Enhance or Ask AI (`/api/website/post/ai`). The drawing is the web's own engine ([DesignEngine]); what goes
 * up is rendered at the web's size and quality and saved with the words in one form (`WebsiteEditPieceScreen`).
 */
class WebsitePhotoEdit(val pieceID: String, private val engine: DesignEngine) {
    /** The photo as the site built it; an AI one is `ai-…` and is never kept in the design (`kept`). */
    companion object {
        const val SITE_PHOTO = "site"

        private val fill = MarketingValue.of(mapOf("mode" to "fill", "zoom" to 1, "focusX" to 0.5, "focusY" to 0.5))

        /** The placement of the photo on show (editor.ts placementOf). */
        fun placement(d: MarketingValue): MarketingValue {
            if (d["placements"].isNull) return d["bg"]["placement"]
            val id = d["bg"].s("photoId")
            return if (id.isEmpty() || d["placements"][id].isNull) fill else d["placements"][id]
        }

        /** A design to keep: always over the site's photo (an AI one isn't kept), and only its own crop. */
        fun kept(doc: MarketingValue): MarketingValue {
            var d = doc.withPath(listOf("bg", "photoId"), MarketingValue.string(SITE_PHOTO))
            d = d.with("placements", MarketingValue.of(mapOf(SITE_PHOTO to placement(doc).any)))
            d = d.with("layers", MarketingValue.array(doc["layers"].array.filter { it.s("kind") != "image" || it.s("src").isNotEmpty() }))
            return d
        }

        /** The weight stamped on the photo going up: a visible text layer bound to the weight, and a weight to show. */
        fun stamped(doc: MarketingValue, fields: Map<String, String>): Boolean =
            !(fields["weight"] ?: "").isEmpty() && doc["layers"].array.any { it.s("kind") == "text" && it.s("bind") == "weight" && !it["hidden"].bool }

        /** The layouts that show the weight (site-design.ts `showsWeight`). */
        fun showsWeight(layout: String): Boolean = layout != "clean" && layout != "mark" && layout != "catalogue-t"

        /** The photo's own shape, 1080 wide (between half and twice as tall as wide), or the square. */
        fun frame(shape: String, size: Pair<Double, Double>?): MarketingValue {
            if (shape != "own" || size == null || size.first <= 0) return MarketingValue.of(mapOf("w" to 1080, "h" to 1080))
            val h = swiftRounded(minOf(2.0, maxOf(0.5, size.second / size.first)) * 1080)
            return MarketingValue.of(mapOf("w" to 1080, "h" to h))
        }

        /** What the photo going up depends on: the design, and the words drawn on it (the web's `sig`). */
        fun sig(doc: MarketingValue, fields: Map<String, String>): String {
            val bound = doc["layers"].array.any { it.s("kind") == "text" && it.s("bind").isNotEmpty() && !it["hidden"].bool }
            return doc.text + if (bound) fields.toSortedMap().toString() else ""
        }
    }

    class Photo(val id: String, val label: String, val data: ByteArray, val width: Double, val height: Double)

    var photos by mutableStateOf<List<Photo>>(emptyList())
        private set
    var doc by mutableStateOf(MarketingValue.NULL)
    var shape by mutableStateOf("own")
        private set
    var layout by mutableStateOf("clean")
        private set
    var layouts by mutableStateOf<List<MarketingValue>>(emptyList())
        private set

    /** What the AI did to the photo going up, in the order it was done ("Enhanced", "Changed with AI"). */
    var ai by mutableStateOf<List<String>>(emptyList())
        private set
    var ready by mutableStateOf(false)
        private set
    var loading by mutableStateOf(false)
        private set
    var problem by mutableStateOf<String?>(null)
        private set

    /** The last design's AI, said once: editing starts from the original photo. */
    var lastAI by mutableStateOf<List<String>>(emptyList())
        private set
    var preview by mutableStateOf<ImageBitmap?>(null)
        private set

    /** The design and words as they were when editing began or was last saved: a photo goes up only when they differ. */
    private var firstSig = ""

    val photoData: Map<String, ByteArray> get() = photos.associate { it.id to it.data }
    private val base: Photo? get() = photos.firstOrNull { it.id == SITE_PHOTO }

    /** The photo on show: the site's, or an AI one chosen over it. */
    val current: Photo? get() = photos.firstOrNull { it.id == doc["bg"].s("photoId") } ?: photos.firstOrNull()

    fun sig(fields: Map<String, String>): String = sig(doc, fields)
    fun changed(fields: Map<String, String>): Boolean = ready && sig(fields) != firstSig
    fun stamped(fields: Map<String, String>): Boolean = stamped(doc, fields)
    fun saved(fields: Map<String, String>) { firstSig = sig(fields) }
    val layoutShowsWeight: Boolean get() = showsWeight(layout)
    val keptDoc: MarketingValue get() = kept(doc)

    private fun blank(s: String): MarketingValue =
        NativeArtwork.blank(SITE_PHOTO, 1080.0).with("frame", frame(s, base?.let { it.width to it.height })).with("placements", MarketingValue.of(emptyMap<String, Any>()))

    private fun photoOf(bytes: ByteArray): Photo? {
        val size = ArtworkPixels.size(bytes) ?: return null
        return Photo(SITE_PHOTO, "The website’s photo", bytes, size.first, size.second)
    }

    // MARK: Starting

    /**
     * The piece's last design and its photograph as the site built it; the design starts as it was last left, or with the
     * house's start layout on the photo as it is.
     */
    suspend fun begin(piece: WebsiteEditPiece, fields: Map<String, String>) {
        if (loading || ready) return
        loading = true
        problem = null
        try {
            val q = WebsiteNumber.query(piece.id)
            val (bytes, saved) = coroutineScope {
                val info = async { try { MarketingRequest.get("/api/website/edits?id=$q") } catch (e: CancellationException) { throw e } catch (e: Exception) { MarketingValue.NULL } }
                val stamp = System.currentTimeMillis()
                val data = ErpApi.shared.bytes("/api/website/site-pieces/image?id=$q&original=1&size=3000&t=$stamp", timeoutMs = 120_000)
                data to info.await()
            }
            val photo = photoOf(bytes) ?: throw ErpApi.Failure(0, "The photograph didn’t come as a picture.")
            photos = listOf(photo)
            val start = engine.run(
                MarketingValue.NULL, emptyMap(), emptyMap(),
                mapOf("action" to "siteLayouts", "sitePiece" to mapOf("photoSource" to piece.photoSource, "sourceMarked" to piece.sourceMarked)),
            )
            layouts = start["layouts"].array
            layout = start.s("start", "clean")
            val design = saved["design"]
            val keptDoc = if (design.isNull) MarketingValue.NULL else MarketingValue.parse(design["design"].string)
            if (!design.isNull && !keptDoc["layers"].isNull) {
                shape = if (design.s("shape", "own") == "square") "square" else "own"
                doc = keptDoc.with("frame", frame(shape, photo.width to photo.height)).withPath(listOf("bg", "photoId"), MarketingValue.string(SITE_PHOTO))
                lastAI = design["ai"].array.map { it.string }.filter { it.isNotEmpty() }
            } else {
                shape = "own"
                doc = square(blank("own"), layout, fields)
            }
            firstSig = sig(fields)
            ready = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = e.message
        } finally {
            loading = false
        }
    }

    /**
     * The Posts tray's Crop & design (src/app/posts/piece-design.tsx): always square, never a kept design; the catalogue's photo
     * from before it was marked (Mina), anything else as the site shows it (the tray's own copy); the layout the piece starts
     * with, the weight on it where the card was stamping it.
     */
    suspend fun beginSquare(piece: PostPiece, sitePhoto: ByteArray, weightOn: Boolean, fields: Map<String, String>) {
        if (loading || ready) return
        loading = true
        problem = null
        try {
            var bytes = sitePhoto
            // As on Edit a piece, the MINA mark is the catalogue's framing; no server flag names it (photoNote there).
            if (House.id == "mina" && piece.photoSource != null) {
                bytes = ErpApi.shared.bytes("/api/website/site-pieces/image?id=${WebsiteNumber.query(piece.id)}&original=1&size=3000", timeoutMs = 120_000)
            }
            val photo = photoOf(bytes) ?: throw ErpApi.Failure(0, "The photograph didn’t come as a picture.")
            photos = listOf(photo)
            val start = engine.run(
                MarketingValue.NULL, emptyMap(), emptyMap(),
                mapOf("action" to "siteLayouts", "weightOn" to weightOn, "sitePiece" to mapOf("photoSource" to piece.photoSource, "sourceMarked" to piece.sourceMarked)),
            )
            layouts = start["layouts"].array
            layout = start.s("start", "clean")
            shape = "square"
            doc = square(blank("square"), layout, fields)
            firstSig = sig(fields)
            ready = true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = e.message
        } finally {
            loading = false
        }
    }

    /** The tray's design as it goes out: WhatsApp's square, 1600 px (piece-design.tsx SEND_PX). */
    suspend fun squareJpeg(fields: Map<String, String>): ByteArray {
        val r = engine.run(doc, photoData, fields, mapOf("px" to 1600, "quality" to 0.92, "site" to true))
        return DesignProtocol.imageBytes(r)?.takeIf { it.isNotEmpty() } ?: throw ErpApi.Failure(0, "The design could not be drawn.")
    }

    /** A layout laid on a design (editor.ts applySquarePreset, through the engine). */
    private suspend fun square(d: MarketingValue, id: String, fields: Map<String, String>): MarketingValue =
        engine.run(d, photoData, fields, mapOf("action" to "square", "value" to id, "site" to true))["doc"]

    suspend fun chooseLayout(id: String, fields: Map<String, String>) {
        try {
            val d = square(doc, id, fields)
            layout = id
            doc = d
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = e.message
        }
    }

    suspend fun chooseShape(s: String, fields: Map<String, String>) {
        if (s == shape) return
        val d = doc.with("frame", frame(s, base?.let { it.width to it.height }))
        try {
            doc = square(d, layout, fields)
            shape = s
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = e.message
        }
    }

    fun use(id: String) {
        doc = doc.withPath(listOf("bg", "photoId"), MarketingValue.string(id))
    }

    // MARK: Drawing

    suspend fun render(fields: Map<String, String>) {
        if (!ready) return
        try {
            val r = engine.run(doc, photoData, fields, mapOf("px" to 900, "site" to true))
            val bitmap = withContext(Dispatchers.Default) { NativeArtwork.image(r) }
            preview = bitmap?.asImageBitmap()
            problem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = e.message
        }
    }

    /**
     * The photo going up: the site's own size, 3000 px on taheri.shop (the catalogue makes its 2000 from it), never enlarged
     * past the photo, at least 1080; a JPEG at 0.92, as the web's canvasToJpeg.
     */
    suspend fun jpeg(fields: Map<String, String>): ByteArray {
        val px = maxOf(1080.0, minOf(3000.0, current?.width ?: 1080.0))
        val r = engine.run(doc, photoData, fields, mapOf("px" to px, "quality" to 0.92, "site" to true))
        return DesignProtocol.imageBytes(r)?.takeIf { it.isNotEmpty() } ?: throw ErpApi.Failure(0, "The photo could not be drawn.")
    }

    // MARK: AI on the photo

    /** What the AI sent back, and whether it should be looked at before saving (the web's checkOk and its toast). */
    suspend fun runAI(op: String, params: Map<String, Any?>, label: String): String? {
        val photo = current ?: throw ErpApi.Failure(0, "The photo couldn't be read.")
        val jpeg = withContext(Dispatchers.Default) { MarketingPhotos.decode(photo.data, 2048)?.let { MarketingPhotos.jpeg(it, 2048, 92) } }
            ?: throw ErpApi.Failure(0, "The photo couldn't be read.")
        val raw = ErpApi.shared.upload(
            "/api/website/post/ai", listOf("op" to op, "params" to MarketingValue.of(params).text),
            listOf(ErpApi.FormFile("image", "image-0.jpg", "image/jpeg", jpeg)), timeoutMs = 240_000,
        )
        val d = MarketingValue.parse(raw)
        val bytes = try { java.util.Base64.getMimeDecoder().decode(d["image"].s("data")) } catch (e: IllegalArgumentException) { null }
        val size = bytes?.let { ArtworkPixels.size(it) }
        if (bytes == null || bytes.isEmpty() || size == null) throw ErpApi.Failure(0, "The AI sent no photo back.")
        val id = "ai-" + java.lang.Long.toString(System.currentTimeMillis(), 36)
        photos = photos + Photo(id, label, bytes, size.first, size.second)
        // The new photo takes the old one's crop.
        var x = doc
        val crop = placement(doc)
        x = x.withPath(listOf("bg", "photoId"), MarketingValue.string(id))
        if (x["placements"].isNull) x = x.with("placements", MarketingValue.of(emptyMap<String, Any>()))
        x = x.withPath(listOf("placements", id), crop)
        doc = x
        ai = ai + label
        val check = d["check"]
        if (check.isNull) return "Could not check it: compare it with the original before saving."
        if (check["samePiece"].bool && check.n("confidence") >= 0.8) return null
        val first = check["differences"].array.firstOrNull()?.string ?: ""
        return "Check this one closely: " + (if (first.isEmpty()) "compare it with the original before saving." else first)
    }
}
