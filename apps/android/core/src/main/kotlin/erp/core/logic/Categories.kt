// Ported from src/lib/categories.ts (staticCategories, categoryTitle, categorySingular) and the lists in
// src/lib/store.ts that the order and sale forms offer: CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABELS, PLATING_TYPES.
// ERPCore's Categories.swift; the first port of core left it out, and New order / New sale read all of it.

package erp.core.logic

data class Category(
    val id: String,
    /** The list name, plural: "Rings". What the pickers and filters show. */
    val title: String,
    /** One of them: "Ring". What a printed bill leads with. */
    val singular: String,
)

val staticCategories: List<Category> = listOf(
    Category("cat001", "Rings", "Ring"),
    Category("cat002", "Tops", "Top"),
    Category("cat003", "Balis", "Bali"),
    Category("cat004", "Lockets", "Locket"),
    Category("cat005", "Bracelets", "Bracelet"),
    Category("cat006", "Bracelet and Ring Set", "Bracelet and Ring Set"),
    Category("cat007", "Bangles", "Bangle"),
    Category("cat008", "Chains", "Chain"),
    Category("cat009", "Bands", "Band"),
    Category("cat010", "Locket Sets without Bangle", "Locket Set without Bangle"),
    Category("cat011", "Locket Set with Bangle", "Locket Set with Bangle"),
    Category("cat012", "String Sets", "String Set"),
    Category("cat013", "Stone Necklace Sets without Bracelets", "Stone Necklace Set without Bracelets"),
    Category("cat014", "Stone Necklace Sets with Bracelets", "Stone Necklace Set with Bracelets"),
    Category("cat015", "Gold Necklace Sets with Bracelets", "Gold Necklace Set with Bracelets"),
    Category("cat016", "Gold Necklace Sets without Bracelets", "Gold Necklace Set without Bracelets"),
    Category("cat017", "Gold Coins", "Gold Coin"),
    Category("cat018", "Men's Rings", "Men's Ring"),
    Category("cat019", "Loose Bracelet", "Loose Bracelet"),
    Category("cat020", "Men's Buttons", "Men's Button"),
)

/** Resolve a category id to its display name; null when unknown. */
fun categoryTitle(id: String?): String? {
    if (id.isNullOrEmpty()) return null
    return staticCategories.firstOrNull { it.id == id }?.title
}

/** One of them: "Ring" for cat001. Null when the id is unknown. */
fun categorySingular(id: String?): String? {
    if (id.isNullOrEmpty()) return null
    return staticCategories.firstOrNull { it.id == id }?.singular
}

/** store.ts CUSTOMER_SOURCES, in the ERP's order. */
val customerSources: List<String> = listOf("taheri_spillover", "referral", "walkin", "social_media", "website", "other")

/** store.ts CUSTOMER_SOURCE_LABELS; null for a key that is not one of the six. */
fun customerSourceLabel(key: String): String? = when (key) {
    "taheri_spillover" -> "Taheri Spillover"
    "referral" -> "Referral"
    "walkin" -> "Walk-in"
    "social_media" -> "Social media"
    "website" -> "Website"
    "other" -> "Other"
    else -> null
}

/** store.ts PLATING_TYPES: the finishes offered on 925 silver. */
val platingTypes: List<String> = listOf("White Rhodium", "21K Gold Plating", "18K Gold Plating", "Chandi White Plating", "Other")

/**
 * categories.ts NAME_RULES: a piece's category from its name, the more particular words first ("bangle & ring" is a
 * set, not a ring). Same order, same patterns, case-insensitive. (Plain `\b` and IGNORE_CASE: nothing Android's regex refuses.)
 */
private val nameRules: List<Pair<Regex, String>> = listOf(
    """\b(men'?s|gents?)\b.*\bring|\bring\b.*\b(men'?s|gents?)\b""" to "cat018",
    """\bbutton""" to "cat020",
    """(bracelet|bangle|kara).*\bring|\bring\b.*(bracelet|bangle|kara)""" to "cat006",
    """\b(locket|takhti|thakti)s? set\b.*bangle""" to "cat011",
    """\b(locket|takhti|thakti)s? set""" to "cat010",
    """\bstring set""" to "cat012",
    """\b(necklace|full set|set)\b.*(bracelet)""" to "cat014",
    """\b(coin|biscuit|bar)\b|\bary\b|\b\d+(\.\d+)?\s?g\b.*24k""" to "cat017",
    """\b(necklace|neckless|full set|set|haar|choker)\b""" to "cat013",
    """\bloose bracelet""" to "cat019",
    """\b(bangle|kara|kangan|churi)""" to "cat007",
    """\bbracelet""" to "cat005",
    """\bchain""" to "cat008",
    """\b(locket|takhti|thakti|taweez|tawiz|pendant)""" to "cat004",
    """\b(bali|balis|hoop)""" to "cat003",
    """\b(tops?|earrings?|studs?|jhum(k|ki|ka|kay))\b""" to "cat002",
    """\bbands?\b""" to "cat009",
    """\brings?\b""" to "cat001",
).map { (pattern, id) -> Regex(pattern, RegexOption.IGNORE_CASE) to id }

/** categories.ts guessCategory: a piece's category from its name, for a line that carries none. */
fun guessCategory(name: String?): String? {
    val n = (name ?: "").trim()
    if (n.isEmpty()) return null
    return nameRules.firstOrNull { (re, _) -> re.containsMatchIn(n) }?.second
}

/**
 * categories.ts lineCategory: a sold line's category for the reports: its own, else the custom order's
 * (`itemCategory`), else read from its name. Empty strings count as none.
 */
fun lineCategory(categoryId: String?, itemCategory: String?, name: String?): String? {
    if (!categoryId.isNullOrEmpty()) return categoryId
    if (!itemCategory.isNullOrEmpty()) return itemCategory
    return guessCategory(name)
}

/**
 * category-breakdown.tsx: a category's share of revenue as written beside its bar: "32%", and one decimal under 10%:
 * "0.7%". [share] is a fraction (0.32).
 */
fun categoryShareText(share: Double): String =
    if (share >= 0.1) "${Math.round(share * 100)}%" else String.format(java.util.Locale.ROOT, "%.1f%%", share * 100)
