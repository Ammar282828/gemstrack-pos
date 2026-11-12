package erp.core.logic

import erp.core.Json

/**
 * The shop's state machines as the ERP exports them (src/lib/machines, apps/iphone/App/Resources/machines.json): every status's
 * words and tone, and every move it allows. The server refuses any other move inside the write's own transaction and answers
 * 409 (see [MoveRefusal]); this table lets a screen offer only what can happen. Pure Kotlin.
 *
 * A move's condition (`when`: "not invoiced", "nothing owed") is words here, not code: the app cannot run the server's guard, so
 * [Machine.can] and [Machine.allowed] answer for the table alone and the server's 409 says why a guarded move was refused.
 */
class MachineMove(
    /** Null for the table's `"*"`: from any state. */
    val from: List<String>?,
    val to: String,
    /** `set` is a person choosing the status; the others are named actions (finalize, refund, book) or the server's own runs. */
    val event: String,
    val condition: String?,
    val note: String?,
) {
    fun leaves(state: String): Boolean = from == null || state in from
}

/** A move a state may make: where to and by which event (the 409's `allowed` entries read the same). */
data class Allowed(val to: String, val event: String)

/** One machine: Order, Repair, Payment link, Website order, TCS booking. */
class Machine(
    val name: String,
    val field: String,
    val states: List<String>,
    val final: List<String>,
    val labels: Map<String, String>,
    /** Tone names as lib/tones.ts has them: late, owed, settled, credit, working, quiet, house. */
    val tones: Map<String, String>,
    val moves: List<MachineMove>,
) {
    /** The words people read for a state; the stored value itself for one the table does not know (old data). */
    fun label(state: String): String = labels[state] ?: state

    fun tone(state: String): String? = tones[state]

    /**
     * May [from] become [to] by [event]? Mirrors the server's `check()` without the guards: the same state is allowed (and
     * writes nothing); a stored state the table does not know (old data) takes any move by that event.
     */
    fun can(from: String?, to: String, event: String = SET): Boolean {
        val cur = from ?: ""
        if (cur == to) return true
        val known = cur in states
        return moves.any { it.to == to && it.event == event && (!known || it.leaves(cur)) }
    }

    /** Every move out of [from] (by [event] when given), to a different state, in the table's order; none for an unknown state. */
    fun allowed(from: String?, event: String? = null): List<Allowed> {
        val cur = from ?: ""
        if (cur !in states) return emptyList()
        return moves.filter { it.leaves(cur) && it.to != cur && (event == null || it.event == event) }
            .map { Allowed(it.to, it.event) }
            .distinct()
    }

    /** The states a person may choose from [from] (event `set`), in the table's state order. */
    fun choices(from: String?): List<String> {
        val to = allowed(from, SET).map { it.to }.toSet()
        return states.filter { it in to }
    }

    fun isFinal(state: String): Boolean = state in final

    companion object {
        const val SET = "set"
    }
}

/** The whole table, by machine name. */
class Machines(val all: List<Machine>, /** Derived states, never stored (machines.json `derived`: Invoice settlement): words and tones only. */ val derived: List<Machine> = emptyList()) {
    private val byName = all.associateBy { it.name } + derived.associateBy { it.name }

    fun machine(name: String): Machine? = byName[name]

    /** The table's own answer, or true for a machine it does not carry (the server decides). */
    fun can(machine: String, from: String?, to: String, event: String = Machine.SET): Boolean =
        byName[machine]?.can(from, to, event) ?: true

    fun allowed(machine: String, from: String?, event: String? = null): List<Allowed> = byName[machine]?.allowed(from, event).orEmpty()

    /** The state's words, or null when the table has none (the caller keeps its own). */
    fun label(machine: String, state: String): String? = byName[machine]?.labels?.get(state)

    /** The state's tone name, or null when the table has none. */
    fun tone(machine: String, state: String): String? = byName[machine]?.tones?.get(state)

    companion object {
        /** No table loaded: every move is allowed here and no word or tone is known, so screens keep their own and the server decides. */
        val EMPTY = Machines(emptyList())

        const val ORDER = "Order"
        const val REPAIR = "Repair"
        const val PAYMENT_LINK = "Payment link"
        const val WEBSITE_ORDER = "Website order"
        const val TCS_BOOKING = "TCS booking"
        const val INVOICE_SETTLEMENT = "Invoice settlement"

        /** machines.json, or [EMPTY] for text that is not the table. */
        fun parse(text: String): Machines {
            val root = Json.parse(text) as? Map<*, *> ?: return EMPTY
            val list = machines(root["machines"])
            // A derived machine has states, words and tones, and no moves: nothing ever sets it.
            val derived = machines(root["derived"])
            return Machines(list, derived)
        }

        private fun machines(v: Any?): List<Machine> =
            (v as? List<*>).orEmpty().mapNotNull { m ->
                val o = m as? Map<*, *> ?: return@mapNotNull null
                val name = o["name"] as? String ?: return@mapNotNull null
                Machine(
                    name = name,
                    field = o["field"] as? String ?: "",
                    states = strings(o["states"]),
                    final = strings(o["final"]),
                    labels = strMap(o["labels"]),
                    tones = strMap(o["tones"]),
                    moves = (o["moves"] as? List<*>).orEmpty().mapNotNull { mv ->
                        val x = mv as? Map<*, *> ?: return@mapNotNull null
                        val to = x["to"] as? String ?: return@mapNotNull null
                        val from = if (x["from"] == "*") null else strings(x["from"])
                        MachineMove(from, to, x["event"] as? String ?: Machine.SET, x["when"] as? String, x["note"] as? String)
                    },
                )
            }

        private fun strings(v: Any?): List<String> = (v as? List<*>).orEmpty().filterIsInstance<String>()

        private fun strMap(v: Any?): Map<String, String> =
            (v as? Map<*, *>).orEmpty().entries.mapNotNull { (k, x) -> if (k is String && x is String) k to x else null }.toMap()
    }
}

/**
 * The 409 a refused move comes back as (src/lib/machines/http.ts): `{ error, machine, from, to, allowed: [{ to, event }] }`.
 * [reason] is the ERP's own words, shown to the person as they are.
 */
class MoveRefusal(val reason: String, val machine: String, val from: String, val to: String, val allowed: List<Allowed>) {
    companion object {
        /** The refusal in a response body, or null for any other body (a duplicate request's 409 has no `machine`). */
        fun parse(body: String): MoveRefusal? {
            val o = Json.parse(body) as? Map<*, *> ?: return null
            val machine = o["machine"] as? String ?: return null
            val reason = (o["error"] as? String)?.takeIf { it.isNotBlank() } ?: return null
            val allowed = (o["allowed"] as? List<*>).orEmpty().mapNotNull { a ->
                val m = a as? Map<*, *> ?: return@mapNotNull null
                Allowed(m["to"] as? String ?: return@mapNotNull null, m["event"] as? String ?: Machine.SET)
            }
            return MoveRefusal(reason, machine, o["from"] as? String ?: "", o["to"] as? String ?: "", allowed)
        }
    }
}
