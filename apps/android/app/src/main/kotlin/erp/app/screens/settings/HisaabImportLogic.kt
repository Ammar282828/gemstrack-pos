package erp.app.screens.settings

import erp.core.Container
import erp.core.Decodable
import erp.core.models.Customer
import erp.core.models.Karigar
import java.text.Collator
import java.util.Locale

/** One row of the file as the ERP read it (hisaab-csv.ts `HisaabCsvRow`). */
data class HisaabRow(val date: String, val isValidDate: Boolean, val description: String, val cashIn: Double, val cashOut: Double) {
    val fine: Boolean get() = isValidDate && (cashIn != 0.0 || cashOut != 0.0)

    companion object : Decodable<HisaabRow> {
        override fun fromMap(m: Map<String, Any?>): HisaabRow {
            val c = Container(m)
            return HisaabRow(c.string("date", ""), c.bool("isValidDate", false), c.string("description", ""), c.double("cashIn", 0.0), c.double("cashOut", 0.0))
        }
    }
}

/** /api/app/imports `{ kind: 'hisaab' }`. */
data class HisaabRead(val rows: List<HisaabRow>, val refusal: String?) {
    companion object {
        fun from(value: Any?): HisaabRead? {
            val m = (value as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: return null
            val c = Container(m)
            return HisaabRead(c.list("rows", HisaabRow), c.string("refusal"))
        }
    }
}

/** Whose hisaab: a customer or a karigar on file (the page's one list of both, by name). */
data class HisaabPerson(val id: String, val name: String, /** "customer" or "karigar". */ val type: String)

object HisaabImportLogic {
    private val collator: Collator = Collator.getInstance(Locale.ENGLISH).apply { strength = Collator.SECONDARY }

    /** Customers and karigars still in the book, by name. */
    fun people(customers: List<Customer>, karigars: List<Karigar>): List<HisaabPerson> =
        (customers.filter { it.deletedAt == null }.map { HisaabPerson(it.id, it.name, "customer") } +
            karigars.filter { it.deletedAt == null }.map { HisaabPerson(it.id, it.name, "karigar") })
            .sortedWith { a, b -> collator.compare(a.name, b.name) }

    /** The picker's search: names holding the typed words, ignoring case. */
    fun shown(people: List<HisaabPerson>, query: String): List<HisaabPerson> {
        val q = query.trim()
        return if (q.isEmpty()) people else people.filter { it.name.contains(q, ignoreCase = true) }
    }

    fun planBody(csv: String): Map<String, Any?> = mapOf("kind" to "hisaab", "csv" to csv)

    /** `importHisaab`: the file again for the person chosen. */
    fun importBody(csv: String, person: HisaabPerson): Map<String, Any?> = mapOf("csv" to csv, "entityId" to person.id, "entityType" to person.type)

    fun canImport(read: HisaabRead?, person: HisaabPerson?, importing: Boolean, error: String?): Boolean =
        !(read?.rows.isNullOrEmpty()) && person != null && !importing && error == null && read?.refusal == null

    fun complete(out: Map<String, Any?>, rows: Int): String {
        val n = (out["imported"] as? Number)?.toInt() ?: rows
        return "$n transactions imported successfully. 0 failed."
    }
}
