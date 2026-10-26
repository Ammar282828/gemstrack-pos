package erp.app.screens.stock

import erp.app.nav.ScreenRoute
import erp.core.entry.NewOrderFormat
import erp.core.logic.PricingRates
import erp.core.logic.ProductCosts
import erp.core.logic.PricedPiece
import erp.core.logic.calculateProductCosts
import erp.core.logic.staticCategories
import erp.core.models.MetalType
import erp.core.models.Product
import erp.core.models.Settings
import java.util.Locale

/**
 * What the Stock list and the piece page say the same way (StockKit.swift): where a piece lives, its category's name,
 * how its metal and weight read, and what it sells for at today's rates. The price is core's (`calculateProductCosts`,
 * the ERP's lib/pricing.ts); what is here is only what src/app/products/page.tsx and products/[sku]/page.tsx work out
 * for themselves.
 */
object StockKit {

    // MARK: Paths

    /** One part of a path: a SKU with a "/" or "?" in it must not split the address (`urlPathAllowed` less `/?#%`). */
    fun encode(part: String): String {
        val keep = "-._~!$&'()*+,;=:@"
        val out = StringBuilder()
        for (b in part.toByteArray(Charsets.UTF_8)) {
            val c = (b.toInt() and 0xFF).toChar()
            if (c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || keep.indexOf(c) >= 0) out.append(c)
            else out.append('%').append(String.format(Locale.ROOT, "%02X", b.toInt() and 0xFF))
        }
        return out.toString()
    }

    /** "/products/RNG-0001": the piece page. `web` asks for the ERP's own page (its QR and CSV for the label printer, and Delete). */
    fun piecePath(sku: String, web: Boolean = false): String = "/products/" + encode(sku) + (if (web) "?web=1" else "")

    /** The product form for a piece. "?web=1" after it is the ERP's own form, which takes the photo. */
    fun editPath(sku: String): String = "/products/" + encode(sku) + "/edit"

    /** "/products/<sku>/edit" → the SKU, decoded (src/app/products/[sku]/edit). Null for any other path. */
    fun editSku(fromPath: String): String? {
        val bare = ScreenRoute.bare(fromPath)
        if (!bare.startsWith("/products/") || !bare.endsWith("/edit")) return null
        val middle = bare.drop("/products/".length)
        if (middle.length <= "/edit".length) return null
        val sku = middle.dropLast("/edit".length)
        if (sku.isEmpty() || sku.contains('/')) return null
        return ScreenRoute.percentDecode(sku)
    }

    /** "/products/add?voice=1": a new piece the ERP's voice assistant filled in, kept in that page's own memory. */
    fun fromVoice(path: String): Boolean {
        val q = path.substringBefore('#').let { if (it.contains('?')) it.substringAfter('?') else return false }
        return q.split('&').contains("voice=1")
    }

    const val addPath = "/products/add"
    const val bulkAddPath = "/products/bulk-add"
    /** Where Sell goes: the sale in progress, which the piece was just put on (it does not open blank). */
    const val newSalePath = "/invoices/new?resume=1"

    /** Pages under /products/ that are not a piece: the forms (adding one, adding many). */
    val ownPages: Set<String> = setOf(addPath, bulkAddPath)

    // MARK: Categories

    data class Category(val id: String, val title: String)

    /** categories.ts staticCategories: the ids and the list names (plural) as the ERP has them. */
    val categories: List<Category> = staticCategories.map { Category(it.id, it.title) }

    private val titleById: Map<String, String> = categories.associate { it.id to it.title }

    /**
     * The list name of a piece's category. The web says "Uncategorized" for an id its table lacks; here a word that is
     * not one of its ids (a hand-typed category) is shown as it was written.
     */
    fun categoryTitle(id: String): String = titleById[id] ?: id.ifEmpty { "Uncategorized" }

    /**
     * The categories worth a chip: the ERP's own in its order, then any other id the stock uses, each only if a piece is
     * in it. `keep` stays even when emptied, so a chosen chip does not vanish under the person.
     */
    fun categoryOptions(counts: Map<String, Int>, keep: String?): List<Category> {
        val out = ArrayList(categories.filter { (counts[it.id] ?: 0) > 0 || it.id == keep })
        val known = categories.map { it.id }.toSet()
        for (id in counts.keys.filter { it !in known && it.isNotEmpty() }.sorted()) out += Category(id, id)
        if ((counts[""] ?: 0) > 0 || keep == "") out += Category("", "Uncategorized")
        return out
    }

    // MARK: Reading a piece

    /** products/page.tsx `getMetalLabel`: "Gold 21K" for gold with a karat, else the metal's word. */
    fun metalLine(p: Product): String {
        val raw = p.metalType.rawValue
        val metal = raw.take(1).uppercase() + raw.drop(1)
        val k = p.karat
        if (p.metalType == MetalType.gold && k != null && k.rawValue.isNotEmpty()) return "$metal ${k.rawValue.uppercase()}"
        return metal
    }

    /** A weight the way the page prints it: "3.4g", "14.25g", "10g". */
    fun grams(g: Double): String = NewOrderFormat.trimmed(g, 3) + "g"

    fun percent(v: Double): String = NewOrderFormat.trimmed(v, 3) + "%"

    fun filled(s: String?): String? = NewOrderFormat.trim(s ?: "").ifEmpty { null }

    fun capitalised(s: String): String = s.take(1).uppercase() + s.drop(1)

    /** Search by name or SKU, as the page does. */
    fun matches(p: Product, query: String): Boolean {
        val q = query.lowercase(Locale.ROOT)
        return p.name.lowercase(Locale.ROOT).contains(q) || p.sku.lowercase(Locale.ROOT).contains(q)
    }

    // MARK: Price

    /** Today's rates, once the shop's settings have arrived. */
    fun rates(settings: Settings?): PricingRates? = settings?.let { PricingRates(it) }

    /** What a piece sells for at these rates (the ERP's `calculateProductCosts`, part by part). */
    fun costs(p: Product, rates: PricingRates): ProductCosts = calculateProductCosts(PricedPiece(p), rates)

    data class RateLine(val label: String, val perGram: Double)

    /** The rate the piece is priced from, as the piece page names it (products/[sku]/page.tsx `getRateForProduct`): null where the page shows none. */
    fun rateLine(p: Product, s: Settings): RateLine? = when (p.metalType) {
        MetalType.gold -> {
            val k = p.karat
            if (k == null || k.rawValue.isEmpty()) null
            else {
                val rate = when (k.rawValue) {
                    "24k" -> s.goldRatePerGram24k
                    "22k" -> s.goldRatePerGram22k
                    "21k" -> s.goldRatePerGram21k
                    "18k" -> s.goldRatePerGram18k
                    else -> 0.0
                }
                RateLine("Gold rate (${k.rawValue.uppercase()})", rate)
            }
        }
        MetalType.silver -> {
            val own = p.silverRatePerGram
            if (own != null && own > 0) RateLine("This piece's silver rate", own) else RateLine("Silver rate (shop)", s.silverRatePerGram)
        }
        MetalType.palladium -> RateLine("Palladium rate", s.palladiumRatePerGram)
        MetalType.platinum -> RateLine("Platinum rate", s.platinumRatePerGram)
        else -> null
    }

    /** "Gold 21K · 3.4g · Rings". */
    fun detail(p: Product): String = listOf(metalLine(p), grams(p.metalWeightG), categoryTitle(p.categoryId)).joinToString(" · ")

    /** The total of a list at today's rates, as the header says it; null (a dash) while any piece is unpriced. */
    fun worth(prices: List<Double?>): Double? {
        var total = 0.0
        for (p in prices) total += p ?: return null
        return total
    }
}
