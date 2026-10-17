// Ported from src/lib/exchange.ts (tests: ExchangeTests, from exchange.test.ts). `ExchangeEntry`
// itself is the model in models/Payments.kt.
//
// Gold (or anything else) the customer hands over, taken off the bill at an agreed value.
//
// One shape everywhere (the owner, 2026-09-25: "make the exchange gold field uniform and add
// the ability to add another"): an order's exchange and an invoice's are the same list of
// rows (what it is, karat, grams, the rate it was taken at, and the value that comes off)
// and an order's list is carried onto its invoice as it is.
//
// Older documents hold one exchange on an order (advanceInExchangeDescription/Value) and one
// description with two amounts on an invoice (exchangeDescription, exchangeAmount1/2);
// orderExchanges and invoiceExchanges read either. Every write also keeps those old fields as
// totals (orderExchangeFields, invoiceExchangeFields), so all the arithmetic that reads them —
// balances, analytics, Shopify, the per-piece split — stays right without knowing about rows.

package erp.core.logic

import erp.core.models.ExchangeEntry
import erp.core.models.Invoice
import erp.core.models.Order

/** `typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0` for a number already in hand. */
private fun num(v: Double?): Double = if (v == null || !v.isFinite()) 0.0 else v

/** Whole rupees (2026-10-17): each row's value rounded, then summed. */
fun exchangeTotal(list: List<ExchangeEntry>?): Double = (list ?: emptyList()).fold(0.0) { acc, e -> acc + rupees(e.value) }

/** "Old ring · 22k · 5.2 g at 22,000/g"; an unnamed row is "Gold" when weighed, else plain "Exchange". */
fun describeExchangeEntry(e: ExchangeEntry): String {
    val named = JS.trim(e.description)
    val parts = mutableListOf(if (named.isEmpty()) (if (JS.has(e.karat) || num(e.weightG) > 0) "Gold" else "Exchange") else named)
    val karat = e.karat
    if (karat != null && karat.isNotEmpty()) parts.add(karat)
    if (num(e.weightG) > 0) {
        // en-PK groups in thousands, as Money.grouped does.
        val rate = if (num(e.ratePerGram) > 0) " at ${Money.grouped(JS.round(num(e.ratePerGram)))}/g" else ""
        parts.add("${JS.number(num(e.weightG))} g$rate")
    }
    return parts.joinToString(" · ")
}

fun describeExchanges(list: List<ExchangeEntry>): String = list.joinToString("; ") { describeExchangeEntry(it) }

/** The rows worth keeping: a value or a name, trimmed, with a karat, grams or rate only when given. */
private fun clean(list: List<ExchangeEntry>): List<ExchangeEntry> =
    list
        .filter { num(it.value) > 0 || JS.trim(it.description).isNotEmpty() }
        .map { e ->
            ExchangeEntry(
                description = JS.trim(e.description),
                karat = if (JS.has(e.karat)) e.karat else null,
                weightG = if (num(e.weightG) > 0) num(e.weightG) else null,
                ratePerGram = if (num(e.ratePerGram) > 0) num(e.ratePerGram) else null,
                value = rupees(e.value),
            )
        }

/** An order's exchange rows, from the list or from the one exchange older orders kept. */
fun orderExchanges(order: Order?): List<ExchangeEntry> {
    if (order == null) return emptyList()
    if (order.exchanges.isNotEmpty()) return clean(order.exchanges)
    val value = num(order.advanceInExchangeValue)
    val description = JS.trim(order.advanceInExchangeDescription ?: "")
    return if (value > 0 || description.isNotEmpty()) listOf(ExchangeEntry(description = description, value = value)) else emptyList()
}

/** An invoice's exchange rows, from the list or from an older invoice's description and two amounts. */
fun invoiceExchanges(inv: Invoice?): List<ExchangeEntry> {
    if (inv == null) return emptyList()
    if (inv.exchanges.isNotEmpty()) return clean(inv.exchanges)
    val described = JS.trim(inv.exchangeDescription ?: "")
    val out = mutableListOf<ExchangeEntry>()
    if (num(inv.exchangeAmount1) > 0) out.add(ExchangeEntry(description = described, value = num(inv.exchangeAmount1)))
    if (num(inv.exchangeAmount2) > 0) out.add(ExchangeEntry(description = if (out.isEmpty()) described else "", value = num(inv.exchangeAmount2)))
    if (out.isEmpty() && described.isNotEmpty()) out.add(ExchangeEntry(description = described, value = 0.0))
    return out
}

/** What an order stores for its exchange rows: the rows, and the old single-exchange totals. */
data class OrderExchangeFields(
    val exchanges: List<ExchangeEntry>,
    val advanceInExchangeDescription: String,
    val advanceInExchangeValue: Double,
)

fun orderExchangeFields(list: List<ExchangeEntry>): OrderExchangeFields {
    val rows = clean(list)
    return OrderExchangeFields(
        exchanges = rows,
        advanceInExchangeDescription = describeExchanges(rows),
        advanceInExchangeValue = exchangeTotal(rows),
    )
}

/** What an invoice stores for its exchange rows: the rows, and the old fields as one total. */
data class InvoiceExchangeFields(
    val exchanges: List<ExchangeEntry>,
    val exchangeDescription: String,
    /** Written only when the rows come to something. */
    val exchangeAmount1: Double?,
)

/** Null when there is nothing to write (the TS answers `{}`). */
fun invoiceExchangeFields(list: List<ExchangeEntry>): InvoiceExchangeFields? {
    val rows = clean(list)
    val total = exchangeTotal(rows)
    if (rows.isEmpty()) return null
    return InvoiceExchangeFields(rows, describeExchanges(rows), if (total > 0) total else null)
}

// The rows as typed in a form (components/shared/exchange-rows.tsx)
// Kept as strings while being typed; ExchangeEntry when the document is written.

data class ExchangeRow(
    val id: String = newExchangeRowId(),
    val description: String = "",
    val karat: String = "",
    val weightG: String = "",
    val ratePerGram: String = "",
    val value: String = "",
    /** Someone typed the value; grams × rate no longer overwrites it. */
    val valueTyped: Boolean = false,
)

/**
 * A change to a row (TS `Partial<ExchangeRow>`): only what is set changes. Presence is what
 * counts: `value = ""` clears the value, null leaves it.
 */
data class ExchangeRowPatch(
    val id: String? = null,
    val description: String? = null,
    val karat: String? = null,
    val weightG: String? = null,
    val ratePerGram: String? = null,
    val value: String? = null,
    val valueTyped: Boolean? = null,
)

/** `parseFloat(s) || 0`. */
private fun n(s: String): Double {
    val v = JS.parseFloat(s)
    return if (v.isNaN()) 0.0 else v
}

/** `Math.random().toString(36).slice(2, 9)`: seven characters. */
fun newExchangeRowId(): String {
    val alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    return (0 until 7).map { alphabet[kotlin.random.Random.nextInt(alphabet.length)] }.joinToString("")
}

fun blankExchangeRow(): ExchangeRow = ExchangeRow()

fun rowsFromExchanges(list: List<ExchangeEntry>): List<ExchangeRow> {
    if (list.isEmpty()) return listOf(blankExchangeRow())
    return list.map { e ->
        ExchangeRow(
            description = e.description,
            karat = e.karat ?: "",
            weightG = if ((e.weightG ?: 0.0) != 0.0) JS.number(e.weightG!!) else "",
            ratePerGram = if ((e.ratePerGram ?: 0.0) != 0.0) JS.number(e.ratePerGram!!) else "",
            value = if (e.value != 0.0) JS.number(e.value) else "",
            valueTyped = true,
        )
    }
}

fun exchangesFromRows(rows: List<ExchangeRow>): List<ExchangeEntry> =
    rows
        .map { r ->
            ExchangeEntry(
                description = JS.trim(r.description),
                karat = r.karat.ifEmpty { null },
                weightG = if (n(r.weightG) > 0) n(r.weightG) else null,
                ratePerGram = if (n(r.ratePerGram) > 0) n(r.ratePerGram) else null,
                value = n(r.value),
            )
        }
        .filter { it.value > 0 || it.description.isNotEmpty() }

fun exchangeRowsTotal(rows: List<ExchangeRow>): Double = rows.fold(0.0) { acc, r -> acc + n(r.value) }

/** Apply a change to one row; grams × rate refills the value unless it was typed. */
fun applyExchangeRowChange(row: ExchangeRow, patch: ExchangeRowPatch): ExchangeRow {
    var next = row
    patch.id?.let { next = next.copy(id = it) }
    patch.description?.let { next = next.copy(description = it) }
    patch.karat?.let { next = next.copy(karat = it) }
    patch.weightG?.let { next = next.copy(weightG = it) }
    patch.ratePerGram?.let { next = next.copy(ratePerGram = it) }
    patch.value?.let { next = next.copy(value = it) }
    patch.valueTyped?.let { next = next.copy(valueTyped = it) }
    patch.value?.let { typed -> next = next.copy(valueTyped = typed.isNotEmpty()) }
    if (!next.valueTyped && (patch.weightG != null || patch.ratePerGram != null)) {
        val computed = JS.round(n(next.weightG) * n(next.ratePerGram))
        next = next.copy(value = if (computed > 0) JS.number(computed) else "")
    }
    return next
}
