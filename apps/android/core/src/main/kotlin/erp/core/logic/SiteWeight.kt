package erp.core.logic

// Ported from src/lib/website/site-weight.ts (SiteWeight.swift; tests: SiteWeightTests): a weight typed on a Posts card,
// whether the website should keep it, and whether it is the post's own. taheri.shop's own photographs only, and only where
// the site has none: a weight already on the site is never changed from a post (Website → Weights changes it).

private val plainNumber = Regex("""^\d+(\.\d+)?$""")

/** A weight as typed ("3.84", "12"): a positive number, or nothing. */
fun validWeight(w: String): Boolean {
    val t = JS.trim(w)
    if (t.isEmpty() || !plainNumber.matches(t)) return false
    return JS.toNumber(w) > 0
}

/**
 * The weight the website should keep for this piece: typed for one of taheri.shop's own photographs (`source`
 * "attributes") that has none, to two places; null otherwise.
 */
fun weightForSite(source: String?, siteGrams: Double?, typed: String): Double? {
    if (source != "attributes" || (siteGrams ?: 0.0) != 0.0) return null
    return if (validWeight(typed)) JS.round(JS.toNumber(typed) * 100) / 100 else null
}

/** The post carries its own weight, not the site's: one is typed, the site has one, and they differ (to two places). */
fun postOnlyWeight(siteGrams: Double?, typed: String): Boolean {
    val site = siteGrams ?: return false
    if (site == 0.0 || !validWeight(typed)) return false
    return JS.round(JS.toNumber(typed) * 100) != JS.round(site * 100)
}
