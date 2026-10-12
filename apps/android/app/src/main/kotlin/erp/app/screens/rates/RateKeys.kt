package erp.app.screens.rates

import erp.core.models.Settings
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/**
 * The day's rates, as the rate sheet words and checks them (RateSheet.swift `RateKeys`; the ERP's rate chip,
 * components/rates/rate-chip.tsx). Pure: the sheet and the chip read these, the tests hold them to the Swift.
 */
object RateKeys {
    class Field(val key: String, val label: String, val value: (Settings) -> Double)

    class Group(val title: String, val fields: List<Field>, val note: String? = null)

    private val gold24 = Field("goldRatePerGram24k", "24K") { it.goldRatePerGram24k }
    private val gold22 = Field("goldRatePerGram22k", "22K") { it.goldRatePerGram22k }
    private val gold21 = Field("goldRatePerGram21k", "21K") { it.goldRatePerGram21k }
    private val gold18 = Field("goldRatePerGram18k", "18K") { it.goldRatePerGram18k }
    private val silver = Field("silverRatePerGram", "Silver") { it.silverRatePerGram }
    private val platinum = Field("platinumRatePerGram", "Platinum") { it.platinumRatePerGram }

    /** The one rate a house watches: 21K for a gold house, silver for a silver one. */
    fun main(metal: String): Field = if (metal == "silver") silver else gold21

    /** The house's own metal first: a silver house files silver under Silver, not "Other metals". */
    fun groups(metal: String): List<Group> {
        val gold = Group("Gold", listOf(gold24, gold22, gold21, gold18))
        val palladium = Group(
            "Palladium",
            listOf(
                Field("palladiumRatePerGram18k", "18K") { it.palladiumRatePerGram18k },
                Field("palladiumRatePerGram12k", "12K") { it.palladiumRatePerGram12k },
                Field("palladiumRatePerGram", "Flat") { it.palladiumRatePerGram },
            ),
            note = "Left at zero, 18K and 12K palladium are priced from the flat rate.",
        )
        if (metal == "silver") {
            return listOf(
                Group("Silver", listOf(Field("silverRatePerGram", "Per gram") { it.silverRatePerGram })),
                gold, palladium, Group("Other metals", listOf(platinum)),
            )
        }
        return listOf(gold, palladium, Group("Other metals", listOf(silver, platinum)))
    }

    private fun format(maxFraction: Int, grouping: Boolean) = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US)).apply {
        isGroupingUsed = grouping
        minimumFractionDigits = 0
        maximumFractionDigits = maxFraction
    }

    /** A rate as read: grouped, with its decimals when it has them ("26,250", "345.5"). Silver is a few hundred rupees a gram, so whole rupees would hide the paisa. */
    fun say(n: Double): String = format(2, true).format(n)

    /** A rate not yet set reads as a dash, not a zero. */
    fun shown(n: Double): String = if (n > 0) say(n) else "—"

    /** A rate as typed into a field: ungrouped, up to two decimals ("26250", "345.5"). */
    fun plain(n: Double): String = format(2, false).format(n)

    /**
     * What was typed, to two decimals as the web's amount box allows. The decimal pad follows the phone's region,
     * so a lone comma with one or two digits after it is a decimal point; any other comma is grouping ("26,250").
     */
    fun parse(text: String): Double? {
        var t = text.filter { !it.isWhitespace() }
        if (t.isEmpty()) return null
        if (!t.contains('.') && t.count { it == ',' } == 1) {
            val i = t.lastIndexOf(',')
            if (t.length - i <= 3) t = t.replaceRange(i, i + 1, ".")
        }
        val n = t.replace(",", "").toDoubleOrNull() ?: return null
        if (!n.isFinite()) return null
        // Swift's .rounded(): halves go away from zero.
        val scaled = n * 100
        return (if (scaled < 0) -floor(-scaled + 0.5) else floor(scaled + 0.5)) / 100
    }

    /** Which fields moved: typed, a real rate, and not within half a paisa of what is stored. Only these are ever sent. */
    fun changed(metal: String, typed: Map<String, String>, settings: Settings?): List<Field> =
        groups(metal).flatMap { it.fields }.filter { f ->
            val v = typed[f.key]?.let(::parse) ?: return@filter false
            v > 0 && abs(v - (settings?.let(f.value) ?: 0.0)) >= 0.005
        }

    /** The `setRates` write's fields: only what moved, and `source` when the fields came from gold.pk. */
    fun payload(changed: List<Field>, typed: Map<String, String>, fromGoldPk: Boolean): Map<String, Any?> {
        val rates = LinkedHashMap<String, Any?>()
        for (f in changed) rates[f.key] = typed[f.key]?.let(::parse)
        val fields = LinkedHashMap<String, Any?>()
        fields["rates"] = rates
        if (fromGoldPk) fields["source"] = "gold.pk"
        return fields
    }
}
