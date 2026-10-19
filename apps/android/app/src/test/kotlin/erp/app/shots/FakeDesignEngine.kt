package erp.app.shots

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Shader
import android.graphics.Typeface
import erp.app.screens.marketing.DesignEngine
import erp.app.screens.marketing.MarketingPhotos
import erp.app.screens.marketing.MarketingValue
import java.io.ByteArrayOutputStream

/**
 * A stand-in for the artwork engine in the screenshot tests: a JVM test has no web view that runs a script, so this answers the
 * messages the screens send (DesignProtocol) with a page drawn by android.graphics from the document's frame, the photograph and
 * the words, and the catalogue the menus read. It is not the engine: the engine itself is checked against its real bundle in
 * headless Chromium (`apps/android/scripts/check-design-engine.mjs`).
 */
class FakeDesignEngine(context: Context) : DesignEngine(context, "taheri") {
    override suspend fun run(doc: MarketingValue, photos: Map<String, ByteArray>, fields: Map<String, String>, options: Map<String, Any?>): MarketingValue {
        val action = options["action"] as? String ?: "render"
        val px = ((options["px"] as? Number)?.toInt() ?: 540).coerceIn(120, 1200)
        val answer = LinkedHashMap<String, Any?>()
        var out = doc
        if (action in listOf("ad", "square", "preset")) out = laidOut(doc)
        answer["doc"] = out
        answer["catalogue"] = catalogue
        answer["names"] = listOf("Ruby Rani Set.jpg", "Ruby Rani Set 2.jpg", "Ruby Rani Set 3.jpg")
        answer["problems"] = emptyList<String>()
        answer["caption"] = "Ruby Rani Set"
        answer["boxes"] = (out["layers"].array.mapIndexed { i, l -> mapOf("id" to l.s("id"), "x" to l.n("x"), "y" to l.n("y"), "w" to l.n("width", 600.0), "h" to 120 + i * 20) })
        answer["added"] = emptyList<String>()
        answer["image"] = java.util.Base64.getEncoder().encodeToString(page(out, photos, fields, px))
        return MarketingValue.of(answer)
    }

    override fun close() {}

    private fun laidOut(doc: MarketingValue): MarketingValue {
        val h = doc["frame"].n("h", 1080.0)
        fun text(id: String, bind: String, y: Double, size: Double, font: String, color: String) =
            mapOf("id" to id, "kind" to "text", "bind" to bind, "x" to 90, "y" to y, "width" to 900, "size" to size, "font" to font, "color" to color, "align" to "left", "rotate" to 0, "opacity" to 1)
        val layers = listOf(
            text("kicker", "kicker", h * 0.62, 34.0, "regular", "#E9C979"),
            text("headline", "headline", h * 0.68, 96.0, "serif", "#FFFFFF"),
            text("weight", "weight", h * 0.86, 40.0, "light", "#FFFFFF"),
        )
        return doc.with("layers", MarketingValue.of(layers))
    }

    private fun page(doc: MarketingValue, photos: Map<String, ByteArray>, fields: Map<String, String>, px: Int): ByteArray {
        val w = doc["frame"].n("w", 1080.0)
        val h = doc["frame"].n("h", 1080.0)
        val width = px
        val height = (px * h / w).toInt().coerceAtLeast(60)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawColor(Color.parseColor(doc["bg"].s("color", "#EDE6DA")))
        val photo = photos[doc["bg"].s("photoId")] ?: photos["photo"]
        val decoded = photo?.let { MarketingPhotos.decode(it, width.coerceAtLeast(300)) }
        if (decoded != null) {
            // The photograph fills the page, cropped to it.
            val scale = maxOf(width.toFloat() / decoded.width, height.toFloat() / decoded.height)
            val dw = decoded.width * scale
            val dh = decoded.height * scale
            canvas.drawBitmap(decoded, null, Rect(((width - dw) / 2).toInt(), ((height - dh) / 2).toInt(), ((width + dw) / 2).toInt(), ((height + dh) / 2).toInt()), paint)
        }
        paint.shader = LinearGradient(0f, height * 0.45f, 0f, height.toFloat(), 0x00000000, 0xCC000000.toInt(), Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = null
        // The bound words, where the layers put them.
        val k = width / w.toFloat()
        for (l in doc["layers"].array) {
            val text = if (l.s("bind").isNotEmpty()) fields[l.s("bind")] ?: "" else l.s("text")
            if (text.isEmpty()) continue
            paint.color = try { Color.parseColor(l.s("color", "#FFFFFF")) } catch (e: IllegalArgumentException) { Color.WHITE }
            paint.textSize = (l.n("size", 40.0) * k).toFloat()
            paint.typeface = if (l.s("font") == "serif") Typeface.SERIF else Typeface.SANS_SERIF
            canvas.drawText(text, (l.n("x") * k).toFloat(), (l.n("y") * k).toFloat() + paint.textSize, paint)
        }
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 80, out)
            out.toByteArray()
        }
    }

    private val catalogue: MarketingValue = MarketingValue.of(
        mapOf(
            "templates" to listOf(mapOf("id" to "headline", "label" to "Headline"), mapOf("id" to "stack-left", "label" to "Left stack"), mapOf("id" to "centred", "label" to "Centred")),
            "presets" to listOf(mapOf("id" to "stack-left", "label" to "Left stack"), mapOf("id" to "centred", "label" to "Centred")),
            "squares" to listOf(mapOf("id" to "catalogue", "label" to "Catalogue"), mapOf("id" to "clean", "label" to "Clean")),
            "siteSquares" to listOf(mapOf("id" to "catalogue", "label" to "Catalogue")),
            "palettes" to listOf(mapOf("id" to "ivory", "label" to "Ivory"), mapOf("id" to "night", "label" to "Night")),
            "plays" to emptyList<Any>(), "stages" to emptyList<Any>(), "maisonHouses" to listOf("Cartier", "Van Cleef & Arpels"),
            "scenes" to listOf(mapOf("id" to "velvet", "label" to "Velvet tray", "suits" to "Rings and sets"), mapOf("id" to "marble", "label" to "White marble", "suits" to "Pendants")),
            "formats" to emptyList<Any>(), "textStyles" to listOf(mapOf("id" to "stamp", "label" to "Stamp")), "badges" to listOf(mapOf("id" to "new", "label" to "New")),
            "shapes" to listOf(mapOf("id" to "heart", "label" to "Heart")), "masks" to listOf("rounded", "ellipse", "arch"),
            "filters" to listOf(mapOf("label" to "Warm", "adjust" to mapOf("warmth" to 20))), "effects" to emptyList<Any>(), "fonts" to emptyList<Any>(),
        ),
    )
}
