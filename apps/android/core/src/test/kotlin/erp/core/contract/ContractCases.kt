package erp.core.contract

import erp.core.DocJSON
import erp.core.entry.EntryHouse
import java.io.File

// The phone's money against the ERP's, from the Android side: `./gradlew :core:contractCases` writes
// apps/android/contract/cases.json, the same file the iPhone's `swift run ContractCases` writes to
// apps/iphone/contract/cases.json (main.swift). ContractTests holds the two equal value for value, and
// src/app/api/app/write/contract.test.ts runs the ERP's own money over both.
//
// The cases are built by the Kotlin New order / New sale code (erp.core.entry), through the same mutating helpers
// the screens call, and turned into `send` (what the screen hands ErpApi.write) and `shown` (the figures it
// displayed). Nothing is worked out here.

/** One case: what the phone shows (`shown`) and what it sends (`send`), for one house. */
class ContractCase(
    val name: String,
    val house: String,
    /** The op's fields exactly as the screen passes them to `ErpApi.write`. */
    val send: Map<String, Any?>,
    /** The figures the screen showed before Save. */
    val shown: Map<String, Double>,
    /** The shop's settings the screen priced with (the server reads none: it prices from what is sent). */
    val settings: Map<String, Any?>,
    /** Stock the sale's pieces come from, keyed by SKU, as the server must find them. */
    val stock: Map<String, Map<String, Any?>> = emptyMap(),
    /** The customers on the books the screen chose from. */
    val customers: List<Map<String, Any?>> = emptyList(),
    /** The same work as a draft in Drafts, in the web form's own shape (NewOrderWebDraft, SaleWebDraft). */
    val draft: Map<String, Any?> = emptyMap(),
) {
    val json: Map<String, Any?>
        get() = mapOf(
            "name" to name, "house" to house, "send" to send, "shown" to shown, "settings" to settings, "stock" to stock,
            "customers" to customers, "draft" to steadyIds(draft),
        )
}

/**
 * A row's id is random (newExchangeRowId) and means nothing to the money: numbered by position, so the file comes out
 * the same on every run (CI regenerates it and fails on a difference).
 */
fun steadyIds(draft: Map<String, Any?>): Map<String, Any?> {
    val d = LinkedHashMap(draft)
    for (key in listOf("exchangeRows", "salePayments")) {
        val rows = d[key] as? List<*> ?: continue
        d[key] = rows.mapIndexed { i, row ->
            @Suppress("UNCHECKED_CAST")
            val r = LinkedHashMap(row as Map<String, Any?>)
            r["id"] = "$key-${i + 1}"
            r
        }
    }
    return d
}

/** Builds a model from a Firestore-shaped dictionary, as the shelves do. */
inline fun <reified T : Any> decode(id: String, data: Map<String, Any?>): T = DocJSON.decode<T>(id, data)

private fun run(house: String, make: () -> List<ContractCase>): List<Map<String, Any?>> {
    EntryHouse.id = house
    return make().map { it.json }
}

/** Every case of both houses, in memory: `{ orders: […], sales: […] }`. */
fun generateCases(): Map<String, Any?> {
    OrderCases.auditEdits()
    val out = linkedMapOf<String, Any?>(
        "orders" to (run("taheri") { OrderCases.taheri() } + run("mina") { OrderCases.mina() }),
        "sales" to (run("taheri") { SaleCases.taheri() } + run("mina") { SaleCases.mina() }),
    )
    // The house is the app's to set; a generator run leaves it where it found it (Taheri's, the default).
    EntryHouse.id = "taheri"
    return out
}

/** The file's text: pretty, sorted keys, a newline at the end. */
fun casesText(): String = JsonOut.pretty(generateCases()) + "\n"

/** `./gradlew :core:contractCases`: writes the file the argument names. */
fun main(args: Array<String>) {
    val target = File(args.firstOrNull() ?: error("usage: ContractMain <path to cases.json>"))
    target.parentFile?.mkdirs()
    target.writeText(casesText(), Charsets.UTF_8)
    println("wrote ${target.path}")
}
