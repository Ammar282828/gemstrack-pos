package erp.app.screens.customers

import erp.core.ERPDate
import erp.core.entry.NewOrderDay
import erp.core.logic.isWalkInName
import erp.core.logic.phoneKey
import erp.core.logic.shouldCreateCustomer
import erp.core.models.Customer

/** What is typed in the edit form, as text, from the profile on file (EditCustomer.swift `CustomerDraft`). Dates are the ERP's "yyyy-mm-dd", or "" for none. */
data class CustomerDraft(
    val name: String = "",
    val phone: String = "",
    val altPhone: String = "",
    val email: String = "",
    val address: String = "",
    val city: String = "",
    val country: String = "",
    /** A `CUSTOMER_SOURCES` word, or "" for not specified. */
    val source: String = "",
    val ringSize: String = "",
    val bangleSize: String = "",
    val braceletSize: String = "",
    val chainLength: String = "",
    val birthday: String = "",
    val anniversary: String = "",
    val preference: String = "",
    val notes: String = "",
) {
    companion object {
        fun of(c: Customer) = CustomerDraft(
            name = c.name, phone = c.phone ?: "", altPhone = c.altPhone ?: "", email = c.email ?: "",
            address = c.address ?: "", city = c.city ?: "", country = c.country ?: "",
            source = c.source?.rawValue ?: "", ringSize = c.ringSize ?: "", bangleSize = c.bangleSize ?: "",
            braceletSize = c.braceletSize ?: "", chainLength = c.chainLength ?: "", birthday = c.birthday ?: "",
            anniversary = c.anniversary ?: "", preference = c.preference ?: "", notes = c.notes ?: "",
        )
    }

    /**
     * What differs from the profile on file, as `updateCustomer` takes it. A field left as it was is not sent, so what
     * this form cannot show faithfully (an old import's date, the tags, the Shopify id) is never overwritten with a blank.
     */
    fun patch(was: Customer): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        fun put(key: String, now: String, before: String?) {
            val n = CustomerKit.trim(now)
            if (n != CustomerKit.trim(before)) out[key] = n
        }
        put("name", name, was.name)
        put("phone", phone, was.phone)
        put("altPhone", altPhone, was.altPhone)
        put("email", email, was.email)
        put("address", address, was.address)
        put("city", city, was.city)
        put("country", country, was.country)
        put("source", source, was.source?.rawValue)
        put("ringSize", ringSize, was.ringSize)
        put("bangleSize", bangleSize, was.bangleSize)
        put("braceletSize", braceletSize, was.braceletSize)
        put("chainLength", chainLength, was.chainLength)
        put("birthday", birthday, was.birthday)
        put("anniversary", anniversary, was.anniversary)
        put("preference", preference, was.preference)
        put("notes", notes, was.notes)
        // A blank name is named after the number: the ERP needs the number to say it, changed or not.
        if (out["name"] == "") out["phone"] = CustomerKit.trim(phone)
        return out
    }

    fun emailOK(): Boolean = CustomerKit.validEmail(email)

    fun canSave(saving: Boolean, was: Customer): Boolean = !saving && emailOK() && patch(was).isNotEmpty()
}

/** "yyyy-MM-dd" and the midnight it starts in Karachi, so the day picked is the day saved (EditCustomer.swift `EditDay`). */
object EditDay {
    fun string(d: java.time.Instant): String = ERPDate.karachiDay(d)

    /** The day in the first ten characters ("1990-06-30", or an instant written "1990-06-30T…"); null if there is none. */
    fun date(s: String): java.time.Instant? = if (s.length >= 10) NewOrderDay.date(s.take(10)) else null
}

/** The new customer form (AddCustomer.swift), as plain logic. */
data class NewCustomerForm(
    val name: String = "",
    val phone: String = "",
    val email: String = "",
    val address: String = "",
    /** A `CUSTOMER_SOURCES` word, or "" for not specified. */
    val source: String = "",
) {
    /** Like the web form, a name is optional: blank becomes "Customer - <number>", or "Unnamed Customer". */
    val nameToSave: String
        get() {
            val n = CustomerKit.trim(name)
            if (n.isNotEmpty()) return n
            val p = CustomerKit.trim(phone)
            return if (p.isEmpty()) "Unnamed Customer" else "Customer - $p"
        }

    /** Unlike a sale, this never makes a walk-in a customer (lib/walk-in.ts): that placeholder is the absence of one. */
    val walkIn: Boolean get() = !shouldCreateCustomer(id = null, name = nameToSave)

    val emailOK: Boolean get() = CustomerKit.validEmail(email)

    fun canSave(saving: Boolean): Boolean = !saving && !walkIn && emailOK

    /** A number already on file is that customer (lib/walk-in.ts), but two people can share a phone: a hint, not a block. */
    fun sameNumber(customers: List<Customer>): Customer? {
        val key = phoneKey(phone)
        if (key.isEmpty()) return null
        return customers.firstOrNull { c -> !CustomerKit.isRemoved(c) && !isWalkInName(c.name) && phoneKey(c.phone) == key }
    }

    /** What `addCustomer` takes (name, number, email, address and source). */
    fun fields(): Map<String, Any?> {
        val out = LinkedHashMap<String, Any?>()
        out["name"] = nameToSave
        CustomerKit.filled(phone)?.let { out["phone"] = it }
        CustomerKit.filled(email)?.let { out["email"] = it }
        CustomerKit.filled(address)?.let { out["address"] = it }
        if (source.isNotEmpty()) out["source"] = source
        return out
    }
}
