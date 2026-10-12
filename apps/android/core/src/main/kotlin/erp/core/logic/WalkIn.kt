// Ported from src/lib/walk-in.ts (tests: WalkInTests, from walk-in.test.ts).
//
// A walk-in: a sale to nobody in particular. No customer picked, no name typed, no number.
//
// It is not a customer. Until 2026-09-29 the cart sent "Walk-in Customer" as the name and
// generateInvoice made a customer of any name it was given without an id, so every walk-in
// sale added a "Walk-in Customer" to the book (17 in Taheri's by then). The usual shape: the
// counter billed first, took the money, then edited the invoice to put the real name on it,
// which re-saved it against a new customer and left the walk-in one pointing at nothing.
//
// Now a walk-in invoice carries no customerId and "Walk-in Customer" as its name; a balance
// it leaves goes to the hisaab under the fixed entity 'walk-in'. A typed name or number is a
// real person and still becomes a customer, unless the number is already on file.

package erp.core.logic

import erp.core.models.Customer
import erp.core.models.Invoice
import erp.core.models.Order

const val WALK_IN_NAME = "Walk-in Customer"

/** The hisaab entityId for a balance nobody's name is on; also what Analytics keys them by. */
const val WALK_IN_ENTITY = "walk-in"

/**
 * "Walk-in Customer", "walk in", "Walkin"… but not "Walk-in Customer - 0300…", a real number.
 * (The TS is the pattern `^walk[\s-]*in(?:[\s-]+customer)?$`, case-insensitive, on the trimmed name.)
 */
fun isWalkInName(name: String?): Boolean {
    val text = JS.trim(name ?: "").lowercase()
    if (!text.startsWith("walk")) return false
    val separator = { c: Char -> c == '-' || JS.isSpace(c) }
    var rest = text.drop(4).dropWhile(separator)
    if (!rest.startsWith("in")) return false
    rest = rest.drop(2)
    if (rest.isEmpty()) return true
    // " customer" needs at least one separator before it.
    if (!separator(rest.first())) return false
    return rest.dropWhile(separator) == "customer"
}

/** The last ten digits, so 0300…, +92300… and 92300… are the same number; "" for too few. */
fun phoneKey(phone: String?): String {
    val digits = (phone ?: "").filter { it in '0'..'9' }
    return if (digits.length >= 7) digits.takeLast(10) else ""
}

private fun nameKey(name: String?): String = collapse(JS.trim(name ?: "")).lowercase()

/** Words split on JavaScript's white space, joined by one space. */
internal fun collapse(s: String): String {
    val words = ArrayList<String>()
    val cur = StringBuilder()
    for (c in s) {
        if (JS.isSpace(c)) {
            if (cur.isNotEmpty()) { words.add(cur.toString()); cur.setLength(0) }
        } else cur.append(c)
    }
    if (cur.isNotEmpty()) words.add(cur.toString())
    return words.joinToString(" ")
}

data class SaleCustomer(
    /** Set when the sale goes to someone already in the book. */
    val id: String? = null,
    val name: String,
    val phone: String,
    /** A person not yet in the book: generateInvoice adds them. Never true for a walk-in. */
    val isNew: Boolean,
)

/**
 * Who a sale in the cart is for. (The TS lists the book as `{id, name, phone?}`; `Customer` has all three.)
 *
 * - A customer picked from the list is that customer (their number, or the one typed if they
 *   have none). A picked "Walk-in Customer" left over from before is not a person: it is read
 *   as a walk-in, so re-saving one of those invoices lets go of it.
 * - Otherwise a typed number already on file is that customer, when no name was typed or the
 *   name typed is theirs. Typing rather than tapping the suggestion no longer makes a second
 *   copy of somebody (House of Mina's book has one number under 23 "Nilofar"s). A number that
 *   belongs to someone of another name is left alone: two people can share a phone.
 * - A typed name, or a number nobody has, is a new customer; a number alone is named
 *   "Walk-in Customer - <number>", as before.
 * - Nothing typed, or only the placeholder (an edited walk-in invoice puts "Walk-in Customer"
 *   back in the name box): a walk-in, and no customer is made.
 */
fun resolveSaleCustomer(
    selectedId: String? = null,
    typedName: String? = null,
    typedPhone: String? = null,
    customers: List<Customer>,
): SaleCustomer {
    val phoneTyped = JS.trim(typedPhone ?: "")
    val nameTyped = if (isWalkInName(typedName)) "" else JS.trim(typedName ?: "")

    val selected = if (JS.has(selectedId)) selectedId else null
    val picked = selected?.let { id -> customers.firstOrNull { it.id == id } }
    if (selected != null && picked == null) {
        // Not in the list this device holds (just added elsewhere, or removed): keep the id and
        // let generateInvoice read the record, as it always has.
        return SaleCustomer(id = selected, name = nameTyped, phone = phoneTyped, isNew = false)
    }
    if (picked != null && !isWalkInName(picked.name)) {
        return SaleCustomer(id = picked.id, name = picked.name, phone = if (JS.has(picked.phone)) picked.phone!! else phoneTyped, isNew = false)
    }

    val key = phoneKey(phoneTyped)
    if (key.isNotEmpty()) {
        val sameNumber = customers
            .filter { !isWalkInName(it.name) && phoneKey(it.phone) == key }
            .jsSorted { a, b -> JS.localeCompare(a.id, b.id).toDouble() }
        val names = sameNumber.map { nameKey(it.name) }.toSet()
        val match: Customer? = if (nameTyped.isNotEmpty()) {
            sameNumber.firstOrNull { nameKey(it.name) == nameKey(nameTyped) }
        } else {
            if (names.size == 1) sameNumber.firstOrNull() else null
        }
        if (match != null) {
            return SaleCustomer(id = match.id, name = match.name, phone = if (JS.has(match.phone)) match.phone!! else phoneTyped, isNew = false)
        }
    }

    if (nameTyped.isNotEmpty()) return SaleCustomer(name = nameTyped, phone = phoneTyped, isNew = true)
    if (phoneTyped.isNotEmpty()) return SaleCustomer(name = "$WALK_IN_NAME - $phoneTyped", phone = phoneTyped, isNew = true)
    return SaleCustomer(name = WALK_IN_NAME, phone = "", isNew = false)
}

/** generateInvoice's side of it: make a customer only for a person, never for the placeholder. */
fun shouldCreateCustomer(id: String? = null, name: String? = null): Boolean =
    !JS.has(id) && JS.trim(name ?: "").isNotEmpty() && !isWalkInName(name)

fun shouldCreateCustomer(info: SaleCustomer): Boolean = shouldCreateCustomer(id = info.id, name = info.name)

/**
 * Who a sale is credited to in Analytics: its customer, else the name it was written for,
 * else nobody. Every walk-in is the one row, however it was recorded: no id, the
 * placeholder name, or (from before 2026-09-29) a customer of its own still named
 * "Walk-in Customer". `currentName` is the book's name for an id, so one of those renamed
 * since to a real person counts as that person.
 */
fun saleCustomerKey(
    customerId: String? = null,
    customerName: String? = null,
    currentName: ((String) -> String?)? = null,
): String {
    val id = if (JS.has(customerId) && customerId != WALK_IN_ENTITY) customerId!! else ""
    if (id.isNotEmpty()) return if (isWalkInName(currentName?.invoke(id) ?: customerName)) WALK_IN_ENTITY else id
    val name = JS.trim(customerName ?: "")
    return if (name.isNotEmpty() && !isWalkInName(name)) "name:$name" else WALK_IN_ENTITY
}

fun saleCustomerKey(invoice: Invoice, currentName: ((String) -> String?)? = null): String =
    saleCustomerKey(customerId = invoice.customerId, customerName = invoice.customerName, currentName = currentName)

fun saleCustomerKey(order: Order, currentName: ((String) -> String?)? = null): String =
    saleCustomerKey(customerId = order.customerId, customerName = order.customerName, currentName = currentName)
