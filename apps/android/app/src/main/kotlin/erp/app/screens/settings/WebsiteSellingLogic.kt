package erp.app.screens.settings

import erp.core.Container
import erp.core.Decodable

// What Settings → Integrations → Selling on the website reads and writes (components/settings/website-settings.tsx;
// lib/website/types.ts WebsiteConfig; WebsiteSellingSettings.swift). Kept apart from the view so a JVM test can hold
// the document and its write to the iPhone's.

/** One collection's pricing, or the default's: a karat and three charges. A collection's row sets only what differs. */
data class WebsitePricing(
    val karat: String? = null,
    val wastagePercentage: Double? = null,
    val makingChargesPerGram: Double? = null,
    val stoneChargesDefault: Double? = null,
) {
    /** Only the fields set, as the page's JSON leaves an emptied box out. */
    fun json(): Map<String, Any> {
        val d = LinkedHashMap<String, Any>()
        if (!karat.isNullOrEmpty()) d["karat"] = karat
        wastagePercentage?.let { d["wastagePercentage"] = it }
        makingChargesPerGram?.let { d["makingChargesPerGram"] = it }
        stoneChargesDefault?.let { d["stoneChargesDefault"] = it }
        return d
    }

    companion object : Decodable<WebsitePricing> {
        override fun fromMap(m: Map<String, Any?>): WebsitePricing {
            val c = Container(m)
            return WebsitePricing(
                karat = c.string("karat")?.takeIf { it.isNotEmpty() },
                wastagePercentage = c.double("wastagePercentage"),
                makingChargesPerGram = c.double("makingChargesPerGram"),
                stoneChargesDefault = c.double("stoneChargesDefault"),
            )
        }
    }
}

/** `app_settings/website`, with the page's defaults for what is missing. */
data class WebsiteSellingConfig(
    val enabled: Boolean = false,
    val defaultPricing: WebsitePricing = WebsitePricing("21k", 0.0, 0.0, 0.0),
    val categoryPricing: Map<String, WebsitePricing> = emptyMap(),
    val diamondPolicy: String = "enquire",
    val diamondChargesDefault: Double = 0.0,
    val palladiumKarat: String = "18k",
    val deliveryCharge: Double = 0.0,
    val freeDeliveryOver: Double? = null,
    val maxRateAgeHours: Double? = null,
    val posCategoryId: String = "",
    val updatedAt: String? = null,
) {
    /** What saveWebsiteConfig takes: the whole document, as the page saves it. */
    fun json(): Map<String, Any> {
        val d = LinkedHashMap<String, Any>()
        d["enabled"] = enabled
        d["defaultPricing"] = defaultPricing.json()
        d["categoryPricing"] = categoryPricing.mapValues { it.value.json() }
        d["diamondPolicy"] = diamondPolicy
        d["diamondChargesDefault"] = diamondChargesDefault
        d["palladiumKarat"] = palladiumKarat
        d["deliveryCharge"] = deliveryCharge
        d["posCategoryId"] = posCategoryId
        if (freeDeliveryOver != null && freeDeliveryOver > 0) d["freeDeliveryOver"] = freeDeliveryOver
        if (maxRateAgeHours != null && maxRateAgeHours > 0) d["maxRateAgeHours"] = maxRateAgeHours
        return d
    }

    /** What the site cannot sell without (the page's `missing`, lib/website/config.ts configReadiness). */
    val missing: List<String>
        get() {
            val m = ArrayList<String>()
            if (posCategoryId.isEmpty()) m.add("an ERP category for website products")
            if (!((defaultPricing.makingChargesPerGram ?: 0.0) > 0)) m.add("a default making charge per gram")
            return m
        }

    /** The collections with a row of their own, in the site's order, any other after them by name. */
    val overridden: List<String>
        get() = categoryPricing.keys.sortedWith(
            compareBy({ WebsiteSelling.siteCollections.indexOf(it).let { i -> if (i < 0) Int.MAX_VALUE else i } }, { it }),
        )

    companion object : Decodable<WebsiteSellingConfig> {
        override fun fromMap(m: Map<String, Any?>): WebsiteSellingConfig {
            val c = Container(m)
            val base = WebsiteSellingConfig()
            // The page fills a stored default's missing fields from its own (website-settings.tsx).
            val stored = c.obj("defaultPricing", WebsitePricing)
            val rows = (m["categoryPricing"] as? Map<*, *>).orEmpty()
            val prices = LinkedHashMap<String, WebsitePricing>()
            for ((k, v) in rows) WebsitePricing.from(v)?.let { prices[k.toString()] = it }
            return WebsiteSellingConfig(
                enabled = c.bool("enabled", false),
                defaultPricing = WebsitePricing(
                    karat = stored?.karat ?: base.defaultPricing.karat,
                    wastagePercentage = stored?.wastagePercentage ?: 0.0,
                    makingChargesPerGram = stored?.makingChargesPerGram ?: 0.0,
                    stoneChargesDefault = stored?.stoneChargesDefault ?: 0.0,
                ),
                categoryPricing = prices,
                diamondPolicy = if (c.string("diamondPolicy") == "gold_only") "gold_only" else "enquire",
                diamondChargesDefault = c.double("diamondChargesDefault") ?: 0.0,
                palladiumKarat = if (c.string("palladiumKarat") == "12k") "12k" else "18k",
                deliveryCharge = c.double("deliveryCharge") ?: 0.0,
                freeDeliveryOver = c.double("freeDeliveryOver")?.takeIf { it > 0 },
                maxRateAgeHours = c.double("maxRateAgeHours")?.takeIf { it > 0 },
                posCategoryId = c.string("posCategoryId", ""),
                updatedAt = c.string("updatedAt"),
            )
        }
    }
}

object WebsiteSelling {
    /** The site's collection folders, the keys a collection's pricing is written under (website-settings.tsx SITE_COLLECTIONS). */
    val siteCollections = listOf(
        "Rings", "Diamond Rings", "Bands", "Palladium Bands for Him",
        "Bangles", "Thin Bangles", "Kara Churi set", "Karay", "Stone Bangles", "Diamond Bangles", "Bracelet", "Diamond Bracelets", "String Bracelets", "Bangle & Ring",
        "Chains", "Lockets", "Contemporary Lockets", "Takhti", "Taweez",
        "Gold Sets", "Diamond Sets", "Stone Sets", "String Set", "Locket Set With Bangle", "Locket sets without Bangle",
        "Tops", "Diamond Tops", "Jhumki", "Baali",
    )
    val karats = listOf("18k", "21k", "22k", "24k")

    /** lib/website/config.ts DEFAULT_MAX_RATE_AGE_HOURS. */
    const val defaultRateAge = 36.0

    /** `saveWebsiteConfig`'s fields: `seq` makes each save its own (the same form saved twice within half a minute is two saves). */
    fun save(config: WebsiteSellingConfig, seq: String): Map<String, Any?> = mapOf("config" to config.json(), "seq" to seq)

    /** A figure as a box holds it: whole numbers without a point, nothing for none (the Swift's `plain`). */
    fun plain(v: Double?): String {
        if (v == null) return ""
        return if (v == Math.rint(v) && kotlin.math.abs(v) < 9e15) v.toLong().toString() else v.toString()
    }

    /** What the person typed in a box that may stay empty: null for empty or unreadable, else the figure (whole when asked). */
    fun read(text: String, whole: Boolean): Double? {
        val v = erp.core.logic.ShopNumber.parse(text) ?: return null
        return if (whole) Math.floor(v + 0.5) else v
    }
}
