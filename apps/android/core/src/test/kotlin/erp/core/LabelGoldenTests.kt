package erp.core

import erp.core.logic.Dither
import erp.core.logic.LabelBitmap
import erp.core.logic.LabelLSC
import erp.core.logic.LabelValues
import erp.core.logic.PNG
import erp.core.logic.Zpl
import erp.core.models.LabelLayout
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The ZPL a phone sends is the web's and the iPhone's byte for byte. `label-golden.json` is what the TypeScript engine
 * (src/lib/zebra-zpl.ts, label-lsc.ts, label-bitmap.ts) printed for a fixed set of made-up tags (the cases are in
 * src/lib/test-fixtures/label-golden.ts; `label-golden.test.ts` holds the file to the TypeScript). Kotlin renders the same
 * tags and must match every character: ~500 labels, the placeholder and date rules, three Label LIVE imports, the bitmaps.
 */
class LabelGoldenTests {
    private val golden: Map<String, Any?> by lazy {
        val text = LabelGoldenTests::class.java.getResourceAsStream("/label-golden.json")!!.readBytes().toString(Charsets.UTF_8)
        @Suppress("UNCHECKED_CAST")
        Json.parse(text) as Map<String, Any?>
    }

    @Suppress("UNCHECKED_CAST")
    private fun list(key: String): List<Map<String, Any?>> = golden[key] as List<Map<String, Any?>>

    private val pieces: List<LabelValues> by lazy {
        @Suppress("UNCHECKED_CAST")
        (golden["pieces"] as List<Map<String, Any?>>).map { m -> m.mapValues { it.value as String } }
    }

    private fun picked(v: Any?): List<LabelValues> = (v as List<*>).map { pieces[(it as Number).toInt()] }

    private fun int(v: Any?): Int? = (v as? Number)?.toDouble()?.toInt()

    private fun check(what: String, mismatches: List<String>, total: Int) {
        assertTrue(total > 0, "$what: no cases")
        assertEquals(emptyList(), mismatches.take(5), "$what: ${mismatches.size} of $total differ")
    }

    @Test
    fun theZplIsTheTypeScriptsToTheLastCharacter() {
        val cases = list("zpl")
        val bad = ArrayList<String>()
        for (c in cases) {
            val layout = LabelLayout.from(c["layout"])!!
            val zpl = Zpl.render(layout, picked(c["pieces"]), int(c["copies"]) ?: 1, int(c["skip"]) ?: 0, int(c["counterStart"]), Instant.ofEpochMilli((c["nowMs"] as Number).toLong()))
            if (zpl != c["zpl"]) bad.add("${c["name"]}:\n  want ${c["zpl"]}\n  got  $zpl")
        }
        check("zpl", bad, cases.size)
    }

    @Test
    fun placeholdersAreFilledAsTheTypeScriptFillsThem() {
        val cases = list("resolve")
        val bad = ArrayList<String>()
        for (c in cases) {
            val text = Zpl.resolveText(c["template"] as String, picked(c["pieces"]), int(c["labelIndex"]) ?: 0, Instant.ofEpochMilli((c["nowMs"] as Number).toLong()), int(c["counterStart"]))
            if (text != c["text"]) bad.add("${c["template"]} (pieces ${c["pieces"]}, label ${c["labelIndex"]}): want ${c["text"]} got $text")
        }
        check("resolve", bad, cases.size)
    }

    @Test
    fun datesAreFormattedAsTheTypeScriptFormatsThem() {
        val cases = list("dates")
        val bad = ArrayList<String>()
        for (c in cases) {
            val text = Zpl.formatDate(c["pattern"] as String, Instant.ofEpochMilli((c["atMs"] as Number).toLong()))
            if (text != c["text"]) bad.add("${c["pattern"]} @ ${c["atMs"]}: want ${c["text"]} got $text")
        }
        check("dates", bad, cases.size)
    }

    @Test
    fun aLabelLiveDesignImportsToTheSameTagAndPrintsTheSameZpl() {
        val cases = list("lsc")
        val bad = ArrayList<String>()
        for (c in cases) {
            val layout = LabelLSC.importDesign(c["lsc"] as String)!!
            if (canon(layout.json) != canon(c["layout"])) bad.add("${c["name"]}: layout\n  want ${canon(c["layout"])}\n  got  ${canon(layout.json)}")
            val zpl = Zpl.render(layout, pieces, copies = 2, now = Instant.ofEpochMilli(Instant.parse("2026-10-24T19:05:09Z").toEpochMilli()))
            if (zpl != c["zpl"]) bad.add("${c["name"]}: zpl\n  want ${c["zpl"]}\n  got  $zpl")
        }
        check("lsc", bad, cases.size)
    }

    @Test
    fun picturesBecomeTheSameBits() {
        val cases = list("bitmaps")
        val bad = ArrayList<String>()
        for (c in cases) {
            val img = PNG.decodeDataURL(c["png"] as String)!!
            val dither = when (c["dither"]) { "atkinson" -> Dither.atkinson; "floyd" -> Dither.floyd; else -> Dither.threshold }
            val bitmap = LabelBitmap.fromRaster(
                img.rgba, img.width, img.height, int(c["width"])!!, int(c["height"])!!, dither,
                (c["threshold"] as? Number)?.toDouble(), (c["brightness"] as? Number)?.toDouble(),
            )
            if (bitmap != c["bitmap"]) bad.add("${c["name"]} ${c["dither"]} ${c["threshold"]} ${c["brightness"]}: want ${c["bitmap"]} got $bitmap")
        }
        check("bitmaps", bad, cases.size)
    }
}
