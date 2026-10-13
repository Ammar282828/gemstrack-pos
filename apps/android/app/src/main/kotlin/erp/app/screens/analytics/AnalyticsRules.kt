package erp.app.screens.analytics

import erp.app.screens.home.DashRules
import erp.app.ui.Weight
import erp.core.logic.categoryTitle
import erp.core.logic.customerSourceLabel
import erp.core.logic.customerSources
import erp.core.logic.toTola
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.Order
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URLEncoder

// The small rules and words the Analytics pages use (AnalyticsRules.swift): thin calls into core, plus the
// formatting they share. Every money rule itself is core's (invoiceSaleValue, bookedAsSale, cashInForPeriod,
// invoicedOrderIds, invoiceMargin / orderMargin, saleCustomerKey).

object AnaRules {
    /** A sale counts on its order's day when it came from one (getInvoiceRevenueDate: the dashboard's one copy). */
    fun revenueDate(inv: Invoice, ordersById: Map<String, Order>): String = DashRules.revenueDate(inv, ordersById)

    /** A partner's drawing is a distribution of profit, not a cost of earning it. */
    fun isBusinessCost(e: Expense): Boolean = DashRules.isBusinessCost(e)
}

/** `staticCategories` (lib/categories.ts): the list name of a category id. */
object AnaCategories {
    fun title(id: String): String = categoryTitle(id) ?: "Uncategorized"
}

/** Where a sale came from (`CUSTOMER_SOURCES`, store.ts), plus the catch-all. */
object AnaSources {
    const val unclassified = "unclassified"

    /** The ERP's order: the six real sources lead and Unclassified trails. */
    val keys: List<String> = customerSources + unclassified

    fun label(key: String): String = customerSourceLabel(key) ?: "Unclassified"
}

/** A SKU worth showing a person (lib/sku.ts stockSku): a piece described for one bill gets a NEW-… or BILL-… key that is not a stock number. */
object AnaSku {
    fun isStock(sku: String): Boolean = sku.isNotEmpty() && !sku.startsWith("NEW-") && !sku.startsWith("BILL-")
}

/** Where a customer's row opens. */
object AnaPath {
    fun customer(id: String): String = "/customers/" + URLEncoder.encode(id, "UTF-8").replace("+", "%20").replace("*", "%2A")
}

/** JavaScript's `sort` is stable; Kotlin's is too, so this is a descending sort that keeps first-seen order among equals. */
object AnaSort {
    fun <T> descending(list: List<T>, by: (T) -> Double): List<T> = list.sortedByDescending(by)
}

/** A name that may be empty: the first of these that has something in it (JS `a || b || c`). */
object AnaText {
    fun firstFilled(options: List<String?>, fallback: String): String = options.firstOrNull { !it.isNullOrEmpty() } ?: fallback
}

object AnaFormat {
    /** `toLocaleString('en-US', { maximumFractionDigits })`: 1,234.5. */
    fun number(x: Double, maxDigits: Int): String = Weight.localeNumber(x, maxDigits.coerceIn(0, 3))

    /** A count the way a JS number prints: 3, or 1.5. */
    fun count(x: Double): String = number(x, 2)

    /** `toFixed(digits)`: the double's exact value, a tie going up. */
    fun fixed(x: Double, digits: Int): String =
        if (!x.isFinite()) x.toString() else BigDecimal(x).setScale(digits, RoundingMode.HALF_UP).toPlainString()

    fun tola(grams: Double): Double = toTola(grams)

    /** "12.5 g · 1.072 tola" (units.ts formatWeight). */
    fun weight(grams: Double): String = Weight.grams(grams)

    fun plural(n: Int, one: String, many: String): String = if (n == 1) one else many
}
