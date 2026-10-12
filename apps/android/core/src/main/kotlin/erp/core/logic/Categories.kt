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
