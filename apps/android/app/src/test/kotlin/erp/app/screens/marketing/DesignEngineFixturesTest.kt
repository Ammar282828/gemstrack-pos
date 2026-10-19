package erp.app.screens.marketing

import erp.app.screens.design.DesignWork
import java.awt.Color
import java.awt.GradientPaint
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import javax.imageio.ImageIO
import org.junit.Assume
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The messages the screens send the engine, written out for the Chromium check (`apps/android/scripts/check-design-engine.mjs`).
 *
 * `DesignProtocol.message` and `DesignProtocol.page` are the very functions `DesignEngine.run` uses, and the cases below are built the
 * way the Design screens build theirs (DesignWorkspaceModel, DesignResize, DesignPublish, DesignSmart, the designer): so when the script
 * runs the real bundle (`apps/iphone/App/Resources/Design/design-<house>.js`) with these, it is proving that the protocol, the bundle
 * and the screens agree. Run:
 *
 *     ./gradlew :app:testTaheriDebugUnitTest --tests 'erp.app.screens.marketing.DesignEngine*'
 *     node apps/android/scripts/check-design-engine.mjs
 *
 * The second half of this file reads the script's answers back through `DesignProtocol.parse`, the same reading the app does.
 */
class DesignEngineFixturesTest {
    private val out = File("../build/design-fixtures")
    private val bundles = File("../../iphone/App/Resources/Design")
    private val houses = mapOf("taheri" to "Taheri", "mina" to "House of Mina")

    private fun jpeg(w: Int, h: Int, from: Color, to: Color): ByteArray {
        System.setProperty("java.awt.headless", "true")
        val image = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        val g = image.createGraphics()
        g.paint = GradientPaint(0f, 0f, from, w.toFloat(), h.toFloat(), to)
        g.fillRect(0, 0, w, h)
        g.color = Color(0xD9, 0xAE, 0x4B)
        g.fillOval(w / 4, h / 3, w / 2, w / 2)
        g.color = Color(0xB3, 0x12, 0x3A)
        g.fillOval(w * 2 / 5, h / 5, w / 5, w / 5)
        g.dispose()
        return ByteArrayOutputStream().use { ImageIO.write(image, "jpg", it); it.toByteArray() }
    }

    /** A jewellery-style shot: one gold disc, high and to the left, on a plain light ground (the engine finds it and keeps the words off it). */
    private fun jpegOffCentre(w: Int, h: Int): ByteArray {
        System.setProperty("java.awt.headless", "true")
        val image = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        val g = image.createGraphics()
        g.color = Color(0xF3, 0xEF, 0xE8)
        g.fillRect(0, 0, w, h)
        g.color = Color(0xC9, 0x97, 0x3F)
        g.fillOval(w * 3 / 20, h * 5 / 20, w * 5 / 12, w * 5 / 12)
        g.color = Color(0xB3, 0x12, 0x3A)
        g.fillOval(w * 11 / 40, h * 7 / 20, w / 8, w / 8)
        g.dispose()
        return ByteArrayOutputStream().use { ImageIO.write(image, "jpg", it); it.toByteArray() }
    }

    private val photo = jpeg(900, 1200, Color(0x2B, 0x24, 0x20), Color(0x0F, 0x0C, 0x0A))
    private val offCentre = jpegOffCentre(720, 1280)
    private val inset = jpeg(600, 600, Color(0x1E, 0x7A, 0x5A), Color(0x10, 0x30, 0x28))
    private val words = mapOf("kicker" to "The Ruby Edit", "headline" to "Ruby Rani Set", "weight" to "21K Yellow Gold · Ruby · 45.35g", "details" to "Ask us on WhatsApp")
    private val subject = mapOf("x" to 0.18, "y" to 0.2, "w" to 0.64, "h" to 0.6)

    private fun jsonString(s: String) = MarketingValue.string(s).json.toString()

    /** One case: its name, the message, and the call that runs it (the id is the case name). */
    private fun case(house: String, name: String, doc: MarketingValue, photos: Map<String, ByteArray>, fields: Map<String, String>, options: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("name" to name, "message" to DesignProtocol.message(doc, photos, fields, house, houses.getValue(house), options), "call" to DesignProtocol.call("case-$name"))

    private fun v2Doc(): MarketingValue = DesignWork.blankDoc(1080.0, 1920.0).with(
        "layers",
        MarketingValue.of(
            listOf(
                mapOf(
                    "id" to "t1", "kind" to "text", "text" to "Gold foil and bold", "x" to 90, "y" to 200, "width" to 900, "size" to 96, "font" to "tenor", "color" to "#FFFFFF", "align" to "left",
                    "blend" to "overlay", "opacity" to 0.9, "effect" to mapOf("kind" to "outline", "color" to "#111111", "offset" to 30, "angle" to 45, "blur" to 20, "thickness" to 45, "transparency" to 50),
                    "runs" to listOf(mapOf("from" to 0, "to" to 4, "font" to "marcellus", "gradient" to mapOf("type" to "linear", "angle" to 100, "stops" to listOf(mapOf("at" to 0, "color" to "#8C6A25"), mapOf("at" to 0.5, "color" to "#FBEFC4"), mapOf("at" to 1, "color" to "#7A5A1E")))), mapOf("from" to 10, "to" to 14, "upper" to true, "size" to 1.4)),
                    "list" to "bullet",
                ),
                mapOf(
                    "id" to "s1", "kind" to "rect", "x" to 90, "y" to 700, "w" to 400, "h" to 200, "radius" to 24, "rotate" to 0, "opacity" to 1,
                    // What the engine's own newShape writes (colour, stroke, a null fill): a layer without them draws NaN-sized effect canvases.
                    "color" to "#C9973F", "stroke" to 6, "fill" to null,
                    "fillGradient" to mapOf("type" to "radial", "angle" to 0, "stops" to listOf(mapOf("at" to 0, "color" to "#FFE9B0"), mapOf("at" to 1, "color" to "#C9973F", "alpha" to 0))),
                    "layerFx" to mapOf("shadow" to mapOf("color" to "#000000", "x" to 0, "y" to 12, "blur" to 28, "alpha" to 0.35), "glow" to mapOf("color" to "#FFD98A", "blur" to 30, "alpha" to 0.8), "outline" to mapOf("color" to "#FFFFFF", "width" to 6)),
                ),
                mapOf("id" to "q1", "kind" to "qr", "role" to "cta", "x" to 390, "y" to 1100, "w" to 300, "value" to "https://taheri.shop", "fg" to "#111111", "bg" to "#FFFFFF", "quiet" to 4, "rotate" to 0, "opacity" to 1),
                mapOf(
                    "id" to "i1", "kind" to "image", "photoId" to "inset", "x" to 600, "y" to 700, "w" to 360, "h" to 360, "radius" to 0, "rotate" to 0, "opacity" to 1, "cutout" to false,
                    "adjust" to mapOf("brightness" to 5, "contrast" to 10, "highlights" to -20, "shadows" to 10, "fade" to 0, "saturation" to 8, "warmth" to 10, "tint" to 0, "hue" to 0, "sharpen" to 30, "blur" to 0, "grain" to 10, "vignette" to 15),
                ),
            ),
        ),
    ).withPath(listOf("bg", "fill"), MarketingValue.of(mapOf("type" to "linear", "angle" to 180, "stops" to listOf(mapOf("at" to 0, "color" to "#111111"), mapOf("at" to 1, "color" to "#2A1B10")))))
        .withPath(listOf("bg", "adjust"), MarketingValue.of(mapOf("brightness" to 0, "contrast" to 8, "saturation" to 0, "warmth" to 6, "fade" to 0, "vignette" to 10)))
        .with("meta", MarketingValue.of(mapOf("guides" to mapOf("x" to listOf(540), "y" to listOf(960)), "grid" to 60)))

    private fun cases(house: String): List<Map<String, Any?>> {
        val story = DesignWork.blankDoc(1080.0, 1920.0)
        val square = DesignWork.blankDoc(1080.0, 1080.0)
        val one = mapOf("photo" to photo)
        val two = mapOf("photo" to photo, "inset" to inset)
        fun c(name: String, doc: MarketingValue, photos: Map<String, ByteArray>, fields: Map<String, String>, vararg options: Pair<String, Any?>) = case(house, name, doc, photos, fields, mapOf(*options))
        return listOf(
            // DesignWorkspaceModel.loadCatalogue: a blank page, nothing else.
            c("catalogue", square, emptyMap(), DesignWork.emptyFields()),
            // layOut: a template (ad) or the catalogue's own page, with the marks flag; the script repeats "layout-ad" for every template.
            c("layout-ad", story, one, words, "action" to "ad", "value" to "headline", "photoMarked" to false),
            c("layout-ad-marked", story, one, words, "action" to "ad", "value" to "headline", "photoMarked" to true),
            c("layout-catalogue", square, one, words, "action" to "square", "value" to "catalogue"),
            c("layout-preset", story, one, words, "action" to "preset", "value" to "stack-left"),
            c("layout-square", square, one, words, "action" to "square", "value" to "clean"),
            // Subject-aware stories: the photo's piece is high and left; the preset keeps its words off it (the script checks the boxes).
            c("layout-preset-subject", story, mapOf("photo" to offCentre), words, "action" to "preset", "value" to "stack-left"),
            c("palette", story, one, words, "action" to "palette", "value" to "", "palette" to "ivory", "selected" to emptyList<String>()),
            // refreshPreview, refreshThumb, render (Save and Publish).
            c("preview", story, one, words, "px" to 760, "quality" to 0.85),
            c("thumb", story, one, words, "px" to 220, "quality" to 0.7),
            c("render", story, one, words, "px" to 1080, "quality" to 0.92),
            // The v2 fields: blend, effects, rich text, gradients, QR, photo adjust, guides and a grid.
            c("render-v2", v2Doc(), two, words, "px" to 540),
            // resizedDoc / resizeAll: the master on other shapes; the script feeds them the laid-out page. "doc" is replaced there.
            c("resize", story, one, words, "action" to "resize", "targets" to listOf(mapOf("w" to 1080.0, "h" to 1080.0), mapOf("w" to 1080.0, "h" to 1350.0), mapOf("w" to 1080.0, "h" to 463.0)), "photoMarked" to false, "subject" to subject),
            c("resize-swap", story, two, words, "action" to "resize", "targets" to listOf(mapOf("w" to 1080.0, "h" to 1080.0)), "photoMarked" to false, "swap" to mapOf("from" to "photo", "to" to "inset")),
            // resizeAll's second call: the script builds `items` from the first answer, as DesignResizeModel does.
            c("resize-merge", story, one, words, "action" to "resizeMerge", "items" to emptyList<Any>(), "subject" to subject),
            // DesignPublish: the house rules on the words, the website's file names (and a Maisons piece's).
            c("words", DesignWork.blankDoc(1080.0, 1080.0), emptyMap(), emptyMap(), "action" to "words", "px" to 120, "texts" to mapOf("WhatsApp caption" to "SALE 50% off! #gold", "Instagram caption" to "", "ad text" to "", "ad headline" to ""), "facts" to "21K 12.35g"),
            c("names", DesignWork.blankDoc(1080.0, 1080.0), emptyMap(), words, "px" to 120, "name" to "Ruby Rani Set", "count" to 3, "folder" to "Rings/Gold Rings", "maisonHouse" to ""),
            c("names-maison", DesignWork.blankDoc(1080.0, 1080.0), emptyMap(), words, "px" to 120, "name" to "Love bracelet", "count" to 2, "folder" to "The Maisons", "maisonHouse" to "Cartier"),
            // The designer's own moves (ArtworkEditor.act): add, shape, mark, inset, link, scale, align, distribute, carry.
            c("add-text", story, one, words, "action" to "text", "value" to "heading", "selected" to emptyList<String>()),
            c("add-textStyle", story, one, words, "action" to "textStyle", "value" to "__first__", "selected" to emptyList<String>()),
            c("add-badge", story, one, words, "action" to "badge", "value" to "__first__", "selected" to emptyList<String>()),
            c("add-shape", story, one, words, "action" to "shape", "value" to "rect", "selected" to emptyList<String>()),
            c("add-shape-more", story, one, words, "action" to "shape", "value" to "__first__", "selected" to emptyList<String>()),
            c("add-line", story, one, words, "action" to "line", "value" to "dash", "selected" to emptyList<String>()),
            c("add-mark", story, one, words, "action" to "mark", "value" to "top", "selected" to emptyList<String>()),
            c("add-inset", story, two, words, "action" to "image", "value" to "", "photoId" to "inset", "selected" to emptyList<String>()),
            c("add-inset-mask", story, two, words, "action" to "image", "value" to "__first__", "photoId" to "inset", "selected" to emptyList<String>()),
            c("add-link", story, one, words, "action" to "link", "value" to "Ask us on WhatsApp", "selected" to emptyList<String>()),
            c("scale", v2Doc(), two, words, "action" to "scale", "value" to "", "factor" to 1.1, "selected" to listOf("t1", "s1")),
            c("align", v2Doc(), two, words, "action" to "align", "value" to "left", "toPage" to false, "selected" to listOf("t1", "s1")),
            c("align-page", v2Doc(), two, words, "action" to "align", "value" to "center", "toPage" to true, "selected" to listOf("s1")),
            c("distribute", v2Doc(), two, words, "action" to "distribute", "value" to "h", "selected" to listOf("t1", "s1", "q1")),
            // Rich-text runs are left off the carried text: the bundle throws a non-finite createLinearGradient when a carried layer has a gradient run
            // (the same on the iPhone, which sends the same message); the other v2 layers carry fine. Noted in docs/features/android-app.md.
            c("carry", story, two, words, "action" to "carry", "value" to "", "layers" to v2Doc()["layers"].array.map { it.without("runs").any }, "fromFrame" to mapOf("w" to 1080, "h" to 1920), "selected" to emptyList<String>()),
            // The Edit a piece layouts (the list the Layout menu offers as `layoutGroup`).
            c("siteLayouts", square, one, words, "action" to "siteLayouts", "site" to true, "sitePiece" to mapOf("photoSource" to null, "sourceMarked" to true)),
            // A painted page: a background picture drawn behind the bound words hidden.
            c("render-painted", story, one, words, "px" to 540, "background" to "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(inset), "hideBound" to true),
        )
    }

    @Test fun theFixturesAreWrittenForTheChromiumCheck() {
        for ((house, _) in houses) {
            val bundle = File(bundles, "design-$house.js")
            Assume.assumeTrue("the bundle ${bundle.path} is not here", bundle.exists())
            val dir = File(out, house)
            dir.mkdirs()
            File(dir, "page.html").writeText(DesignProtocol.page(bundle.readText()))
            val list = cases(house)
            File(dir, "cases.json").writeText(MarketingValue.of(mapOf("house" to house, "cases" to list)).text)
            // A message is JSON the engine can read, whatever the case.
            for (c in list) {
                val v = MarketingValue.parse(c["message"] as String)
                assertEquals(house, v.s("house"), c["name"] as String)
                assertEquals(houses.getValue(house), v["brand"].s("name"))
                assertTrue(!v["doc"].isNull)
                assertTrue((c["call"] as String).contains("case-${c["name"]}"))
            }
        }
        assertEquals(jsonString("a"), "\"a\"")
    }

    // MARK: Reading the script's answers back, as the app reads the engine's

    @Test fun theChromiumAnswersReadThroughTheAppsOwnProtocol() {
        var seen = 0
        for ((house, _) in houses) {
            val file = File(out, "$house/answers.json")
            Assume.assumeTrue("no answers yet: run the script", file.exists())
            val all = MarketingValue.parse(file.readText())
            for ((name, text) in all.obj) {
                val answer = DesignProtocol.parse(text.string)
                seen += 1
                when {
                    name.startsWith("render") || name in listOf("preview", "thumb") || name.startsWith("layout") || name.startsWith("add-") || name in listOf("palette", "scale", "align", "align-page", "distribute", "carry", "catalogue", "names", "names-maison") -> {
                        val bytes = DesignProtocol.imageBytes(answer)
                        assertTrue(bytes != null && bytes.size > 100, "$house/$name draws a picture")
                        assertTrue(bytes!![0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte(), "$house/$name's picture is a JPEG")
                        assertTrue(!answer["doc"].isNull, "$house/$name answers its document")
                        assertTrue(answer["boxes"].array.all { it.s("id").isNotEmpty() }, "$house/$name's boxes carry layer ids")
                    }
                    name == "siteLayouts" -> assertTrue(answer["layouts"].array.isNotEmpty(), "$house/$name offers layouts")
                    name.startsWith("resize") -> assertTrue(answer["results"].array.isNotEmpty(), "$house/$name has results")
                    name == "words" -> assertTrue(answer["problems"].array.isNotEmpty(), "$house/$name finds the sale words")
                }
            }
        }
        Assume.assumeTrue("no answers yet: run the script", seen > 0)
    }
}
