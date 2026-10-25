package erp.app.screens.settings

import erp.core.ERPDate
import erp.core.models.LabelLayout
import erp.core.models.Product
import java.time.Instant

/**
 * The tag designer's small pure rules (LabelSettings.swift and the designer around it). The tag itself, its fields and the ZPL
 * they print as are core's (`erp.core.models.LabelLayout`, `erp.core.logic.Zpl`), shared with the web and the iPhone.
 */
object LabelLogic {
    /** /api/app/labels: the standard tag. */
    fun standard(answer: Any?): LabelLayout? = LabelLayout.from((answer as? Map<*, *>)?.get("standard"))?.takeIf { it.hasSize }

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
}
