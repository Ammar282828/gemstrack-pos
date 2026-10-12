// Ported from src/lib/materials.ts. (It has no TS test; MaterialsTests pins the rules the
// comments below state.) `MetalType` and `KaratValue` themselves are in models/Words.kt.
//
// Metals and karats: the single source of truth.
//
// These lists and labels were previously re-declared in the order form, the
// product form and the order detail page, and the display string was
// hand-built in nine different places. They had already drifted: silver read
// as "925 Sterling Silver" on invoices, slips, the cart and the order form,
// but as plain "Silver" in the product form.

package erp.core.logic

import erp.core.ERPDate
import erp.core.models.DeliveryInfo
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.PieceMaterial

val METAL_TYPES: List<MetalType> = listOf(MetalType.gold, MetalType.palladium, MetalType.platinum, MetalType.silver)
val KARAT_VALUES: List<KaratValue> = listOf(KaratValue.k12, KaratValue.k18, KaratValue.k21, KaratValue.k22, KaratValue.k24)

/**
 * Which karats each metal is actually sold in here.
 *
 * A flat list offered 24k palladium and 22k platinum, neither of which this shop has
 * ever made, while palladium's real 12k and 18k were missing entirely. Platinum and
 * silver carry no karat at all: silver is 925 by assay, and saying "21k silver" is
 * how a wrong rate gets picked.
 */
val KARATS_BY_METAL: Map<MetalType, List<KaratValue>> = mapOf(
    MetalType.gold to listOf(KaratValue.k18, KaratValue.k21, KaratValue.k22, KaratValue.k24),
    MetalType.palladium to listOf(KaratValue.k12, KaratValue.k18),
    MetalType.platinum to emptyList(),
    MetalType.silver to emptyList(),
)

/** The karats to offer for a metal; empty means the field should not be shown. (Texts the list does not know, such as an `unknown` metal, offer none.) */
fun karatsFor(metalType: MetalType): List<KaratValue> = KARATS_BY_METAL[metalType] ?: emptyList()
fun karatsFor(metalType: String?): List<KaratValue> = karatsFor(MetalType.of(metalType ?: ""))

/** Does this metal carry a karat at all? */
fun metalHasKarat(metalType: MetalType): Boolean = karatsFor(metalType).isNotEmpty()
fun metalHasKarat(metalType: String?): Boolean = karatsFor(metalType).isNotEmpty()

/** How a metal is named to a human. Silver is always the full assay name. */
fun metalLabel(metalType: String?): String {
    if (metalType.isNullOrEmpty()) return ""
    if (metalType == "silver") return "925 Sterling Silver"
    return metalType.substring(0, 1).uppercase() + metalType.substring(1)
}

fun metalLabel(metalType: MetalType): String = metalLabel(metalType.rawValue)

/** Karat means something for gold and palladium (see displayKarat in categories.ts). */
fun karatLabel(karat: String?): String {
    if (karat.isNullOrEmpty()) return ""
    return karat.uppercase()
}

fun karatLabel(karat: KaratValue?): String = karatLabel(karat?.rawValue)

/**
 * Full description of an item's material, e.g.
 *   describeMetal("gold", "21k")       → "Gold (21K)"
 *   describeMetal("palladium", "18k")  → "Palladium (18K)"
 *   describeMetal("silver", "21k")     → "925 Sterling Silver"   (karat ignored)
 */
fun describeMetal(metalType: String?, karat: String? = null): String {
    val base = metalLabel(metalType)
    // Palladium is sold at 12k and 18k here, so it reads its karat the same as gold does.
    if (karat.isNullOrEmpty() || !metalHasKarat(metalType)) return base
    return "$base (${karatLabel(karat)})"
}

fun describeMetal(metalType: MetalType, karat: KaratValue? = null): String = describeMetal(metalType.rawValue, karat?.rawValue)

/** The finish on a 925 silver piece, e.g. "White Rhodium · Nickel free". Null for non-silver or when nothing was specified. */
fun describePlating(item: PieceMaterial): String? {
    if (item.metalType != MetalType.silver) return null
    val parts = mutableListOf<String>()
    val note = item.platingNote?.let { JS.trim(it) }
    val plating = item.platingType
    if (plating == "Other" && note != null && note.isNotEmpty()) parts.add(note)
    else if (plating != null && plating.isNotEmpty()) parts.add(plating)
    if (item.nickelFree) parts.add("Nickel free")
    return if (parts.isEmpty()) null else parts.joinToString(" · ")
}

private val LINE_BREAK = Regex("""(?U)\s*\n+\s*""")

/**
 * What is actually set into a piece, for the customer's copy.
 *
 * The invoice already prints what the stones *cost* ("+ Diamonds: PKR
 * 45,000") but never what they are. A customer paying for a 1.12ct VVS2
 * stone should see that on the bill, not just its price; it is the part they
 * would take to a valuer.
 *
 * Only what was actually recorded is printed. Nothing is inferred from a
 * charge being present, because "there is a diamond charge" is not a
 * description of a diamond.
 */
fun describeSettings(item: PieceMaterial): List<String> {
    val lines = mutableListOf<String>()
    // A note typed over several lines reads as one, joined with a dot.
    val oneLine = { s: String -> JS.trim(LINE_BREAK.replace(s, " · ")) }

    val diamonds = item.diamondDetails?.let { JS.trim(it) }
    if (diamonds != null && diamonds.isNotEmpty()) lines.add("Diamonds: ${oneLine(diamonds)}")

    val stones = item.stoneDetails?.let { JS.trim(it) }
    if (stones != null && stones.isNotEmpty()) lines.add("Stones: ${oneLine(stones)}")

    val sw = if (item.stoneWeightG.isNaN()) 0.0 else item.stoneWeightG
    if (sw > 0) lines.add("Stone weight: ${JS.toFixed(sw, 2)}g")

    describePlating(item)?.let { lines.add("Finish: $it") }

    return lines
}

/**
 * The delivery block for a printed invoice, as lines.
 *
 * Empty when the sale is not being delivered, so the caller can leave the
 * whole section off rather than printing an empty heading.
 *
 * The expected day is printed "5 Oct 2026" (the TS prints it in the viewer's own locale), as
 * Karachi's day.
 */
fun describeDelivery(d: DeliveryInfo?): List<String> {
    if (d == null || !d.required || JS.trim(d.address).isEmpty()) return emptyList()
    val lines = mutableListOf<String>()
    val name = JS.trim(d.contactName ?: "")
    val phone = JS.trim(d.contactPhone ?: "")
    // The recipient only earns a line when it is not the person on the bill.
    if (name.isNotEmpty()) {
        lines.add(if (phone.isEmpty()) name else "$name · $phone")
    } else if (phone.isNotEmpty()) {
        lines.add(phone)
    }
    lines.add(listOf(JS.trim(d.address), JS.trim(d.city ?: "")).filter { it.isNotEmpty() }.joinToString(", "))
    val expected = d.expectedDate
    if (expected != null && expected.isNotEmpty()) {
        val t = JS.newDate(expected)
        if (t != null) {
            val local = t.atOffset(ERPDate.karachi)
            lines.add("Expected ${local.dayOfMonth} ${JS.shortMonths[local.monthValue - 1]} ${local.year}")
        }
    }
    val notes = JS.trim(d.notes ?: "")
    if (notes.isNotEmpty()) lines.add(notes)
    return lines
}
