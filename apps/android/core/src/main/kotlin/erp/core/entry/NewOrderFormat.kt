package erp.core.entry

import erp.core.ERPDate
import erp.core.logic.Money
import erp.core.logic.ShopNumber
import erp.core.logic.customerSourceLabel
import erp.core.logic.customerSources
import erp.core.logic.gramsPerTola
import erp.core.logic.platingTypes
import erp.core.logic.rupees
import erp.core.logic.staticCategories
import erp.core.swiftDouble
import erp.core.swiftRounded
import erp.core.swiftTrim
import erp.core.swiftTrimNewlines
import java.time.Instant

// What the order form's views and its arithmetic share, with no screen in it: how typed text becomes a
// number, Karachi's days, and the lists the web keeps in store.ts. (NewOrderFormat.swift.)

// Numbers

object NewOrderFormat {
    fun trim(s: String): String = swiftTrimNewlines(s)

    /** What was typed, as a number by the one reader; anything unreadable is 0 (`Number(x) || 0`). Never NaN or infinity. */
    fun num(s: String): Double = ShopNumber.parse(s) ?: 0.0

    /** Typed but not a number ("12abc"): the field is invalid, not 0 (a screen shows it and holds Save). */
    fun unreadable(s: String): Boolean = ShopNumber.isUnreadable(s)

    /**
     * Typed as a figure below zero ("-5"): the reader takes no sign, so "-5" is unreadable and would count as 0; the
     * refusals that say "cannot be negative" ask this too, so a minus is still told as one.
     */
    fun negative(s: String): Boolean {
        val t = s.trim()
        return t.startsWith("-") && ShopNumber.parse(t.drop(1).trim()) != null
    }

    /** Below zero as typed, or as read. */
    fun below0(s: String): Boolean = num(s) < 0 || negative(s)

    fun finite(x: Double): Double = if (x.isFinite()) x else 0.0

    /** 4.2, 22.5, 8: no trailing zeros. */
    fun trimmed(x: Double, digits: Int = 3): String {
        if (!x.isFinite()) return "0"
        var s = Money.fixed(x, digits)
        if (s.contains('.')) {
            s = s.trimEnd('0')
            if (s.endsWith('.')) s = s.dropLast(1)
        }
        return if (s == "-0") "0" else s
    }

    /** A number back into a box; 0 is blank (decisions.md "Number fields": no pre-filled zeros to delete). */
    fun boxText(x: Double, digits: Int = 2): String = if (x == 0.0) "" else trimmed(x, digits)

    /**
     * A sum of money for a box: whole rupees (ERPCore `rupees`, half up), blank for none. An old order's
     * paise are not carried into a field that types only digits (owner, 2026-10-17: "there should be no decimals").
     */
    fun rupeeBox(x: Double?): String = boxText(rupees(x), digits = 0)

    /** 1 piece, 3 pieces. */
    fun pieces(n: Int): String = if (n == 1) "1 piece" else "$n pieces"
}

// Karachi's days

/**
 * A promised day is a bare "yyyy-MM-dd" in Karachi's calendar (lib/order-timing.ts, the form's
 * `<input type="date">`). Karachi has no daylight saving, so a day is 86,400 seconds.
 */
object NewOrderDay {
    private val dayText = Regex("""^\d{4}-\d{2}-\d{2}$""")

    fun string(d: Instant): String = ERPDate.karachiDay(d)

    /** Midnight at the start of that day in Karachi. */
    fun date(s: String): Instant? {
        if (s.isEmpty() || !dayText.matches(s)) return null
        return ERPDate.parse(s)?.minusSeconds(5L * 3600)
    }

    val today: String get() = string(Instant.now())

    /** The day N days from today (the form's `promiseIn`). */
    fun after(days: Int): String = string(Instant.now().plusSeconds(days.toLong() * 86_400))

    /** Whole days from today to that day: negative once it has passed. */
    fun daysAway(s: String): Int? {
        val d = date(s) ?: return null
        val t = date(today) ?: return null
        val seconds = (d.epochSecond - t.epochSecond).toDouble()
        return swiftRounded(seconds / 86_400).toInt()
    }
}

// Lists the web keeps in store.ts

data class NewOrderChoice(val id: String, val label: String)

object NewOrderWords {
    /** store.ts CUSTOMER_SOURCES / CUSTOMER_SOURCE_LABELS. */
    val sources: List<NewOrderChoice> = customerSources.map { NewOrderChoice(it, customerSourceLabel(it) ?: it) }

    /** categories.ts staticCategories. */
    val categories: List<NewOrderChoice> = staticCategories.map { NewOrderChoice(it.id, it.title) }

    /** store.ts PLATING_TYPES. */
    val platings: List<String> = platingTypes

    /** The trade's tola, in grams (lib/units.ts): the 24k rate for our margin is typed per tola. */
    const val gramsPerTola: Double = erp.core.logic.gramsPerTola
}
