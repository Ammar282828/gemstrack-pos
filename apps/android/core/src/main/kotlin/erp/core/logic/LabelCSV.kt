package erp.core.logic

import erp.core.ERPDate
import erp.core.ERPDecode
import erp.core.models.Product
import erp.core.models.Settings
import java.time.Instant

// Ported from ERPCore's LabelCSV.swift = src/lib/label-csv.ts (tests: LabelCSVTests, label-csv.test.ts).
//
// The tag printer's CSV: pieces in pairs, a left and a right tag to a row. The text only. What the browser's
// `generateProductCsv` (lib/csv.ts) puts in the download is this plus the byte-order mark, and `LabelLive` (the Label LIVE
// link) reads the same column values, so a design built on the file is filled exactly as an import of the file would fill it.
//
// A piece's price is worked out at the shop's rates by `calculateProductCosts` (Pricing.kt) with the flat palladium rate
// only, as the TS passes the shop's rates (the per-karat palladium rates stay out).

object LabelCSV {
    /** One tag's columns, in order; the file has each twice, `_1` for the left tag and `_2` for the right. (TS `BASE_HEADERS`.) */
    val baseHeaders: List<String> = listOf(
        // Primary Details
        "sku", "product_name", "category_id", "shop_name", "image_url",
        // Pricing
        "total_price_pkr", "is_custom_price", "custom_price",
        // Primary Metal
        "metal_type", "metal_weight_g", "karat",
        // Secondary Metal
        "secondary_metal_type", "secondary_metal_weight_g", "secondary_karat",
        // Stones & Diamonds
        "has_stones", "stone_weight_g", "has_diamonds", "stone_details", "diamond_details",
        // Charges
        "making_charges", "diamond_charges", "stone_charges", "misc_charges", "wastage_percentage",
        // QR
        "qr_content",
    )

    /** The file's name as the browser downloads it: `gemstrack_double_tag_export_2026-10-09-08-30-00.csv` (UTC). */
    fun fileName(now: Instant = Instant.now()): String {
        val stamp = ERPDate.iso(now).take(19).replace(':', '-').replace('T', '-')
        return "gemstrack_double_tag_export_$stamp.csv"
    }

    /** The CSV for these pieces at the shop's rates, without the byte-order mark the download puts in front. */
    fun productCsv(products: List<Product>, settings: Settings): String {
        val headers = baseHeaders.map { "${it}_1" } + baseHeaders.map { "${it}_2" }

        fun formatField(value: String): String =
            if (value.contains(",") || value.contains("\"") || value.contains("\n")) "\"" + value.replace("\"", "\"\"") + "\"" else value

        fun dataOf(product: Product?): List<String> {
            val raw = values(product, settings)
            return baseHeaders.map { formatField(raw[it] ?: "") }
        }

        val rows = ArrayList<String>()
        // Two pieces to a row; an odd last piece leaves the right tag empty.
        var i = 0
        while (i < products.size) {
            val left = dataOf(products[i])
            val right = dataOf(if (i + 1 < products.size) products[i + 1] else null)
            rows.add((left + right).joinToString(","))
            i += 2
        }
        return (listOf(headers.joinToString(",")) + rows).joinToString("\n")
    }

    /**
     * One tag's values as the CSV has them, unquoted: what a label design built on this file (House of Mina's "minalabel" in
     * Label LIVE) reads. No piece (the right tag of an odd last row): every column empty. (TS `labelCsvValues`.)
     */
    fun values(product: Product?, settings: Settings): Map<String, String> {
        if (product == null) return baseHeaders.associateWithTo(LinkedHashMap()) { "" }
        val costs = calculateProductCosts(PricedPiece(product), PricingRates(settings).flatPalladiumOnly)
        fun whole(x: Double): String = JS.number(JS.round(x))
        val out = LinkedHashMap<String, String>()
        out["sku"] = product.sku
        out["product_name"] = product.name
        out["category_id"] = product.categoryId
        out["shop_name"] = settings.shopName
        out["image_url"] = product.imageUrl ?: ""
        out["total_price_pkr"] = whole(costs.totalPrice)
        out["is_custom_price"] = if (product.isCustomPrice) "TRUE" else "FALSE"
        out["custom_price"] = product.customPrice?.let { whole(it) } ?: "0"
        out["metal_type"] = product.metalType.rawValue
        out["metal_weight_g"] = JS.toFixed(product.metalWeightG, 3)
        out["karat"] = product.karat?.rawValue ?: ""
        out["secondary_metal_type"] = product.secondaryMetalType?.rawValue ?: ""
        out["secondary_metal_weight_g"] = product.secondaryMetalWeightG?.let { JS.toFixed(it, 3) } ?: "0"
        out["secondary_karat"] = product.secondaryMetalKarat?.rawValue ?: ""
        out["has_stones"] = if (product.hasStones) "TRUE" else "FALSE"
        out["stone_weight_g"] = JS.toFixed(product.stoneWeightG, 3)
        out["has_diamonds"] = if (product.hasDiamonds) "TRUE" else "FALSE"
        out["stone_details"] = product.stoneDetails ?: ""
        out["diamond_details"] = product.diamondDetails ?: ""
        out["making_charges"] = whole(product.makingCharges)
        out["diamond_charges"] = whole(product.diamondCharges)
        out["stone_charges"] = whole(product.stoneCharges)
        out["misc_charges"] = whole(product.miscCharges)
        out["wastage_percentage"] = JS.toFixed(product.wastagePercentage, 2)
        out["qr_content"] = product.sku
        return out
    }

    /**
     * A piece as Firestore holds it, made safe for the CSV: the SKU from the document's id when the field is missing (an
     * update strips it), and the figures the CSV prints with toFixed as numbers (an old import keeps some as text, and a
     * missing one would stop the whole file). `Product` decodes leniently ("1,000" would read as 1000), so the figures are
     * settled here first, as `Number(v)` does.
     */
    fun pieceForCsv(sku: String, doc: Map<String, Any?>): Product {
        fun num(key: String): Double {
            val n = jsNumber(doc, key)
            return if (n.isFinite()) n else 0.0
        }
        fun opt(key: String): Double? {
            val v = doc[key] ?: return null
            if (v is String && v.isEmpty()) return null
            return num(key)
        }
        val out = LinkedHashMap(doc)
        val own = doc["sku"] as? String
        out["sku"] = if (!own.isNullOrEmpty()) own else sku
        for (key in listOf("metalWeightG", "stoneWeightG", "makingCharges", "diamondCharges", "stoneCharges", "miscCharges", "wastagePercentage")) {
            out[key] = num(key)
        }
        for (key in listOf("customPrice", "secondaryMetalWeightG")) {
            val n = opt(key)
            if (n != null) out[key] = n else out.remove(key)
        }
        return ERPDecode.model<Product>(out) ?: ERPDecode.model<Product>(mapOf("sku" to (out["sku"] ?: sku)))!!
    }

    /** `Number(v)` for a value read from a document: a missing key is NaN, an explicit null 0. */
    internal fun jsNumber(doc: Map<String, Any?>, key: String): Double = jsNumber(doc[key], doc.containsKey(key))

    internal fun jsNumber(v: Any?, present: Boolean = true): Double = when {
        !present -> Double.NaN
        v == null -> 0.0
        v is Boolean -> if (v) 1.0 else 0.0
        v is Number -> v.toDouble()
        v is String -> JS.toNumber(v)
        else -> Double.NaN
    }
}
