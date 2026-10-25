package erp.core.models

import erp.core.Container
import erp.core.Decodable
import erp.core.logic.JS
import java.time.Instant
import java.util.UUID

// The shop's tag (src/lib/label-layout.ts `StoredLabelLayout`), kept in settings as `labelLayout`: the label's size in
// printer dots, and the fields on it. Ported from ERPCore's LabelLayout.swift. Decoded leniently like every model here;
// written as the same JSON the web stores (a key is left out when the value is not set), so a layout saved from the
// phone is the browser's too.
//
// Every position is in dots from the label's TOP-LEFT; a field's x, y is the corner of its rotated box (^FO).
// The ZPL a layout prints as is logic/Zpl.kt; a Label LIVE design becomes one in logic/LabelLSC.kt.

enum class LabelFieldType(val raw: String) {
    text("text"), qr("qr"), barcode("barcode"), line("line"), box("box"), ellipse("ellipse"), image("image");

    companion object {
        fun of(raw: String?): LabelFieldType? = entries.firstOrNull { it.raw == raw }
    }
}

/**
 * What the printer is told before each label (TS `LabelPrinterSettings`). The words are the TypeScript's: thermal
 * `transfer`/`direct`; mode `tear`/`peel`/`cutter`/`rewind`/`delayed-cut`; media `gap`/`mark`/`continuous`; orientation
 * `normal`/`inverted`. A word it does not know is kept and simply not sent.
 */
data class LabelPrinterSettings(
    val thermal: String? = null,
    val mode: String? = null,
    val media: String? = null,
    /** 0-30 (~SD). */
    val darkness: Int? = null,
    /** Inches a second, 2-14 (^PR). */
    val speed: Int? = null,
    /** -120...120 (^LT). */
    val labelTop: Int? = null,
    /** -9999...9999 (^LS). */
    val labelShift: Int? = null,
    /** -120...120 (~TA). */
    val tearOff: Int? = null,
    val orientation: String? = null,
    val mirror: Boolean? = null,
    val homeX: Int? = null,
    val homeY: Int? = null,
) {
    val isEmpty: Boolean get() = this == LabelPrinterSettings()

    /** As the web stores it: only what is set. */
    val json: Map<String, Any?>
        get() = buildMap {
            thermal?.let { put("thermal", it) }; mode?.let { put("mode", it) }; media?.let { put("media", it) }
            darkness?.let { put("darkness", it) }; speed?.let { put("speed", it) }
            labelTop?.let { put("labelTop", it) }; labelShift?.let { put("labelShift", it) }
            tearOff?.let { put("tearOff", it) }; orientation?.let { put("orientation", it) }
            mirror?.let { put("mirror", it) }; homeX?.let { put("homeX", it) }; homeY?.let { put("homeY", it) }
        }

    companion object : Decodable<LabelPrinterSettings> {
        override fun fromMap(m: Map<String, Any?>): LabelPrinterSettings {
            val c = Container(m)
            return LabelPrinterSettings(
                thermal = c.string("thermal"), mode = c.string("mode"), media = c.string("media"),
                darkness = c.dots("darkness"), speed = c.dots("speed"), labelTop = c.dots("labelTop"), labelShift = c.dots("labelShift"),
                tearOff = c.dots("tearOff"), orientation = c.string("orientation"), mirror = c.bool("mirror"),
                homeX = c.dots("homeX"), homeY = c.dots("homeY"),
            )
        }
    }
}

/** One field on the tag (TS `LabelField`). Which properties matter depends on `type`; the rest stay null. */
data class LabelLayoutField(
    val id: String,
    val type: LabelFieldType,
    val x: Int = 0,
    val y: Int = 0,
    /** 0, 90, 180 or 270, clockwise. */
    val rotation: Int = 0,
    /** text, qr, barcode: may hold `{placeholders}`; text may hold new lines. */
    val data: String? = null,
    /** The designer's: a hidden field is skipped on print. */
    val hidden: Boolean = false,
    /** The designer's: it cannot be dragged. */
    val locked: Boolean = false,
    /** The designer's: a name for the layers list. */
    val name: String? = null,

    // text
    val fontFamily: String? = null,
    /** Dots; 20 when unset. */
    val fontSize: Int? = null,
    /** text: with a width the text wraps and aligns in a block. line, box, ellipse, image: the size. */
    val width: Int? = null,
    val lines: Int? = null,
    val lineSpacing: Int? = null,
    /** "L", "C" or "R". */
    val align: String? = null,
    val bold: Boolean? = null,

    // qr
    val qrMagnification: Int? = null,
    /** "L", "M", "Q" or "H". */
    val errorCorrection: String? = null,

    // barcode
    /** "code128" (when unset), "code39", "ean13", "upca", "datamatrix" or "pdf417". */
    val symbology: String? = null,
    val height: Int? = null,
    val moduleWidth: Int? = null,
    val showText: Boolean? = null,

    // line, box, ellipse
    val thickness: Int? = null,
    val rounding: Int? = null,
    val fill: Boolean? = null,

    // image
    /** Base64 of the monochrome picture, 1 bit a pixel, rows padded to whole bytes, 1 = black. */
    val bitmap: String? = null,
    /** "threshold", "atkinson" or "floyd". */
    val dither: String? = null,
    val threshold: Double? = null,
    /** The PNG data URL it was made from, kept only when under 64 KB. */
    val source: String? = null,
) {
    /** As the web stores it: a rotation of 0 and the designer's flags when off are left out. */
    val json: Map<String, Any?>
        get() = buildMap {
            put("id", id); put("type", type.raw); put("x", x); put("y", y)
            if (rotation != 0) put("rotation", rotation)
            data?.let { put("data", it) }
            if (hidden) put("hidden", true)
            if (locked) put("locked", true)
            name?.let { put("name", it) }
            fontFamily?.let { put("fontFamily", it) }; fontSize?.let { put("fontSize", it) }
            width?.let { put("width", it) }; lines?.let { put("lines", it) }
            lineSpacing?.let { put("lineSpacing", it) }; align?.let { put("align", it) }
            bold?.let { put("bold", it) }
            qrMagnification?.let { put("qrMagnification", it) }; errorCorrection?.let { put("errorCorrection", it) }
            symbology?.let { put("symbology", it) }; height?.let { put("height", it) }
            moduleWidth?.let { put("moduleWidth", it) }; showText?.let { put("showText", it) }
            thickness?.let { put("thickness", it) }; rounding?.let { put("rounding", it) }
            fill?.let { put("fill", it) }
            bitmap?.let { put("bitmap", it) }; dither?.let { put("dither", it) }
            threshold?.let { put("threshold", it) }; source?.let { put("source", it) }
        }

    companion object {
        /** A field from a document value; null for a field of a type this does not know (a list of fields drops it). */
        fun decode(value: Any?): LabelLayoutField? {
            @Suppress("UNCHECKED_CAST")
            val m = value as? Map<String, Any?> ?: return null
            val c = Container(m)
            val kind = LabelFieldType.of(c.string("type")) ?: return null
            val turn = c.dots("rotation") ?: 0
            return LabelLayoutField(
                id = c.string("id") ?: "", type = kind, x = c.dots("x") ?: 0, y = c.dots("y") ?: 0,
                rotation = if (turn == 90 || turn == 180 || turn == 270) turn else 0,
                data = c.string("data"), hidden = c.bool("hidden") ?: false, locked = c.bool("locked") ?: false, name = c.string("name"),
                fontFamily = c.string("fontFamily"), fontSize = c.dots("fontSize"), width = c.dots("width"), lines = c.dots("lines"),
                lineSpacing = c.dots("lineSpacing"), align = c.string("align"), bold = c.bool("bold"),
                qrMagnification = c.dots("qrMagnification"), errorCorrection = c.string("errorCorrection"),
                symbology = c.string("symbology"), height = c.dots("height"), moduleWidth = c.dots("moduleWidth"), showText = c.bool("showText"),
                thickness = c.dots("thickness"), rounding = c.dots("rounding"), fill = c.bool("fill"),
                bitmap = c.string("bitmap"), dither = c.string("dither"), threshold = c.double("threshold"), source = c.string("source"),
            )
        }

        /** The designer's "Add Text Field". */
        fun newText(now: Instant = Instant.now()) = LabelLayoutField(
            id = "field-${now.toEpochMilli()}", type = LabelFieldType.text, x = 10, y = 10, data = "New text", fontSize = 20,
        )
    }
}

/** The tag (TS `StoredLabelLayout`): its size in dots and its fields. */
data class LabelLayout(
    val id: String,
    val name: String,
    val widthDots: Int,
    val heightDots: Int,
    /** 203 when unset; 300 and 600 are allowed. */
    val dpi: Int? = null,
    /** Pieces to a label: 1 when unset, 2 for a double (butterfly) tag. */
    val tags: Int? = null,
    val printer: LabelPrinterSettings? = null,
    val fields: List<LabelLayoutField> = emptyList(),
) {
    /** Pieces to a label (1...12). */
    val tagsPerLabel: Int get() = tags?.takeIf { it >= 1 }?.let { minOf(12, it) } ?: 1

    /** A layout that can be drawn and printed: it has a size. */
    val hasSize: Boolean get() = widthDots > 0 && heightDots > 0

    val effectivePrinter: LabelPrinterSettings get() = printer ?: LabelPrinterSettings()

    /** The layout as the web stores it, a JSON map the write takes as `layout`. */
    val json: Map<String, Any?>
        get() = buildMap {
            put("id", id); put("name", name); put("widthDots", widthDots); put("heightDots", heightDots)
            dpi?.let { put("dpi", it) }; tags?.let { put("tags", it) }
            printer?.takeIf { !it.isEmpty }?.let { put("printer", it.json) }
            put("fields", fields.map { it.json })
        }

    /** The fields `saveLabelLayout` expects: `layout`, and `seq` that makes each save its own (a field moved and moved back is a new change). */
    fun saveFields(seq: String = UUID.randomUUID().toString()): Map<String, Any?> = mapOf("layout" to json, "seq" to seq)

    companion object : Decodable<LabelLayout> {
        /** The ERP's name for the write that saves a layout (/api/app/write, src/lib/writes/label-layout.ts). */
        const val saveOp = "saveLabelLayout"

        /** The Zebra 2000T's dumbbell jewellery tag, 83 x 37 mm (TS `STANDARD_LABEL_LAYOUT`): the SKU up the left, its QR on the right. */
        val standard = LabelLayout(
            id = "zebra-2000t-jewellery", name = "Zebra 2000T Jewellery Tag (83x37mm)", widthDots = 664, heightDots = 296,
            fields = listOf(
                LabelLayoutField(id = "sku-left", type = LabelFieldType.text, x = 100, y = 150, rotation = 90, data = "SKU: {sku}", fontSize = 20),
                LabelLayoutField(id = "qr-right", type = LabelFieldType.qr, x = 450, y = 80, data = "{sku}", qrMagnification = 4),
            ),
        )

        override fun fromMap(m: Map<String, Any?>): LabelLayout {
            val c = Container(m)
            var p: LabelPrinterSettings? = c.obj("printer", LabelPrinterSettings)
            // Older layouts kept darkness and speed at the top: `printer` says it when it has them, else they move in.
            val darkness = c.dots("darkness")
            val speed = c.dots("speed")
            if (p?.darkness == null && darkness != null) p = (p ?: LabelPrinterSettings()).copy(darkness = darkness)
            if (p?.speed == null && speed != null) p = (p ?: LabelPrinterSettings()).copy(speed = speed)
            return LabelLayout(
                id = c.string("id") ?: "", name = c.string("name", ""),
                widthDots = c.dots("widthDots") ?: 0, heightDots = c.dots("heightDots") ?: 0,
                dpi = c.dots("dpi"), tags = c.dots("tags"), printer = p,
                fields = c.list("fields") { LabelLayoutField.decode(it) }.filter { it.id.isNotEmpty() },
            )
        }
    }
}

/**
 * A whole number of dots from a number or a numeric text: halves go up as `Math.round` has them, and an absurd size is
 * held to a million (the write refuses anything over 8000 anyway).
 */
internal fun Container.dots(key: String): Int? {
    val d = double(key) ?: return null
    return minOf(1_000_000.0, maxOf(-1_000_000.0, JS.round(d))).toInt()
}
