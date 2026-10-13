package erp.app.screens.settings

import erp.core.Container
import erp.core.Decodable
import erp.core.ERPDate
import erp.core.models.Product
import java.time.Instant

/** One field on the tag (lib/label-layout.ts `LabelField`): a text, or the QR code, in the printer's dots. */
data class LabelField(
    val id: String,
    /** "text" or "qr". */
    val type: String,
    val x: Int,
    val y: Int,
    /** 0, 90, 180 or 270. */
    val rotation: Int,
    val data: String,
    val fontSize: Int?,
    val qrMagnification: Int?,
    val fontFamily: String?,
) {
    /** As the ERP stores it: a rotation of 0 and an unset size are left out, as the page leaves them. */
    val stored: Map<String, Any?>
        get() = buildMap {
            put("id", id); put("type", type); put("x", x); put("y", y); put("data", data)
            if (rotation != 0) put("rotation", rotation)
            fontSize?.let { put("fontSize", it) }
            qrMagnification?.let { put("qrMagnification", it) }
            fontFamily?.let { put("fontFamily", it) }
        }

    companion object : Decodable<LabelField> {
        override fun fromMap(m: Map<String, Any?>): LabelField {
            val c = Container(m)
            return LabelField(
                id = c.string("id") ?: "",
                type = if (c.string("type") == "qr") "qr" else "text",
                x = c.int("x") ?: 0, y = c.int("y") ?: 0, rotation = c.int("rotation") ?: 0,
                data = c.string("data", ""),
                fontSize = c.int("fontSize"), qrMagnification = c.int("qrMagnification"), fontFamily = c.string("fontFamily"),
            )
        }

        /** The page's "Add Text Field". */
        fun new(now: Instant = Instant.now()) = LabelField(
            id = "field-${now.toEpochMilli()}", type = "text", x = 10, y = 10, rotation = 0,
            data = "New Text", fontSize = 20, qrMagnification = null, fontFamily = null,
        )
    }
}

/** The tag (lib/label-layout.ts `StoredLabelLayout`): its size in dots and its fields. */
data class LabelLayout(val id: String, val name: String, val widthDots: Int, val heightDots: Int, val fields: List<LabelField>) {
    val stored: Map<String, Any?>
        get() = mapOf("id" to id, "name" to name, "widthDots" to widthDots, "heightDots" to heightDots, "fields" to fields.map { it.stored })

    companion object : Decodable<LabelLayout> {
        override fun fromMap(m: Map<String, Any?>): LabelLayout {
            val c = Container(m)
            return LabelLayout(
                id = c.string("id") ?: "", name = c.string("name", ""),
                widthDots = c.int("widthDots") ?: 0, heightDots = c.int("heightDots") ?: 0,
                fields = c.list("fields", LabelField).filter { it.id.isNotEmpty() },
            )
        }
    }
}

/** The one field of the settings document the designer reads. */
data class LabelDoc(val labelLayout: LabelLayout?) {
    companion object : Decodable<LabelDoc> {
        override fun fromMap(m: Map<String, Any?>): LabelDoc {
            val layout = Container(m).obj("labelLayout", LabelLayout)
            return LabelDoc(layout?.takeIf { it.widthDots > 0 && it.heightDots > 0 })
        }
    }
}

/** The designer's pure rules (LabelSettings.swift). */
object LabelLogic {
    /** /api/app/labels: the standard tag. */
    fun standard(answer: Any?): LabelLayout? = LabelLayout.from((answer as? Map<*, *>)?.get("standard"))

    /** A whole number of dots, as the page's number box reads one (`parseInt(value) || 0`). */
    fun dots(typed: String): Int = typed.filter { it.isDigit() || it == '-' }.toIntOrNull() ?: 0

    /** The page's `parseInt(value) || 20`. */
    fun fontSize(typed: String): Int = typed.filter { it.isDigit() }.toIntOrNull()?.takeIf { it > 0 } ?: 20

    /** The pieces whose name or SKU holds the search, the first fifty. */
    fun hits(products: List<Product>, search: String): List<Product> {
        val q = search.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        return products.asSequence().filter { it.name.lowercase().contains(q) || it.sku.lowercase().contains(q) }.take(50).toList()
    }

    /** The page's file name: gemstrack_double_tag_export_<UTC time>.csv */
    fun csvName(now: Instant): String {
        val stamp = ERPDate.iso(now).take(19).replace(":", "-").replace("T", "-")
        return "gemstrack_double_tag_export_$stamp.csv"
    }

    /** The `saveLabelLayout` write's fields; `seq` makes each save its own (a field moved and moved back is a new change). */
    fun savePayload(layout: LabelLayout, seq: String): Map<String, Any?> = mapOf("layout" to layout.stored, "seq" to seq)

    /** A layout after one field changes, found by id at the moment of the change. */
    fun edit(layout: LabelLayout, id: String, apply: (LabelField) -> LabelField): LabelLayout =
        layout.copy(fields = layout.fields.map { if (it.id == id) apply(it) else it })

    fun saveStateText(edited: Boolean, saving: Boolean, saved: Boolean): String = if (edited || saving) "Saving…" else if (saved) "Layout saved." else ""
}
