// Ported from src/lib/karigar-pay.ts (tests: KarigarPayTests, its cases): a karigar's pay as his page shows it.
// What he has been paid in all, the pay batch open now and what is in it, the settled batches, the payments
// outside any batch, and the silver he has brought in. The server settles a batch at `batchTotal` worked out
// the same way, so the total the owner is shown before settling is the one written.
//
// And src/app/my-work/page.tsx, src/app/api/karigar/me/route.ts and `groupJobsByOrder` in
// src/lib/workshop.ts (tests: KarigarPortalTests): what a karigar sees of their own work.
//
// The server hand-picks the fields (no customer names, phone numbers, prices or totals ever reach a
// karigar), so everything here is read from that answer and nothing else. It is not a Firestore
// document: the app asks /api/karigar/me, the same route the portal page asks.

package erp.core.logic

import erp.core.Container
import erp.core.Decodable
import erp.core.ERPDate
import erp.core.models.Expense
import erp.core.models.KarigarBatch
import erp.core.models.KarigarSilverTransaction
import erp.core.seconds

object KarigarPay {
    /** One batch and the payments filed under it, newest first. */
    data class InBatch(val batch: KarigarBatch, val payments: List<Expense>, val total: Double) {
        val id: String get() = batch.id
    }

    class Figures(
        /** Every payment to him, in the batches and outside them. */
        val totalPaid: Double,
        /** The newest open batch, which a payment from his page is filed under. */
        val open: InBatch?,
        /** The closed ones, newest start first; each totalled from its payments as they are now. */
        val settled: List<InBatch>,
        /** Paid outside any batch, newest first. */
        val direct: List<Expense>,
        val directTotal: Double,
    )

    class Silver(
        /** His entries, newest first. */
        val rows: List<KarigarSilverTransaction>,
        val grams: Double,
        val surcharge: Double,
    )

    /** A date as a number to sort by (`Date.parse`); one that cannot be read sorts as the oldest. */
    internal fun time(iso: String?): Double = ERPDate.parse(iso)?.seconds ?: 0.0

    /** Newest first; equal dates keep the order they came in, as the TypeScript's stable sort keeps them. */
    internal fun <T> newestFirst(rows: List<T>, date: (T) -> String): List<T> =
        rows.withIndex()
            .map { Triple(it.index, it.value, time(date(it.value))) }
            .sortedWith { a, b -> if (a.third != b.third) (if (a.third > b.third) -1 else 1) else a.first.compareTo(b.first) }
            .map { it.second }

    internal fun total(rows: List<Expense>): Double = rows.fold(0.0) { acc, e -> acc + e.amount }

    /** A batch with no closing date is the one open now (a blank one too, as `!b.closedDate` reads it). */
    fun isOpen(b: KarigarBatch): Boolean = (b.closedDate ?: "").isEmpty()

    /** Filed under no batch: no batch id, or a blank one. */
    internal fun isDirect(e: Expense): Boolean = (e.batchId ?: "").isEmpty()

    /** The payments filed under a batch, newest first: his expenses that carry its id. */
    fun batchPayments(batch: KarigarBatch, expenses: List<Expense>): List<Expense> =
        newestFirst(expenses.filter { it.karigarId == batch.karigarId && it.batchId == batch.id }) { it.date }

    /** What a batch comes to: what settling it writes as its total paid. */
    fun batchTotal(batch: KarigarBatch, expenses: List<Expense>): Double = total(batchPayments(batch, expenses))

    fun figures(karigarId: String, expenses: List<Expense>, batches: List<KarigarBatch>): Figures {
        val payments = expenses.filter { it.karigarId == karigarId }
        val mine = batches.filter { it.karigarId == karigarId }
        // Newest start first; equal starts keep the order they came in.
        val ordered = newestFirst(mine) { it.startDate }
        fun filed(b: KarigarBatch): InBatch {
            val rows = batchPayments(b, payments)
            return InBatch(batch = b, payments = rows, total = total(rows))
        }
        // A payment whose batch is gone (a deleted batch used to leave its id behind) is listed as direct.
        val known = mine.map { it.id }.toSet()
        val direct = newestFirst(payments.filter { isDirect(it) || !known.contains(it.batchId ?: "") }) { it.date }
        return Figures(
            totalPaid = total(payments),
            open = ordered.firstOrNull { isOpen(it) }?.let { filed(it) },
            settled = ordered.filter { !isOpen(it) }.map { filed(it) },
            direct = direct,
            directTotal = total(direct),
        )
    }

    /** The silver form's surcharge: the grams received at the rate per gram, as the entry stores it. */
    fun silverSurcharge(grams: Double, perGram: Double): Double = grams * perGram

    /** The silver form's rules: grams above nothing, a surcharge of nothing or more. Null when it may be saved. */
    fun silverProblem(grams: Double, perGram: Double): String? {
        if (!grams.isFinite() || grams <= 0) return "Silver grams must be greater than 0"
        if (!perGram.isFinite() || perGram < 0) return "Surcharge must be non-negative"
        return null
    }

    /** His silver: the entries newest first, the grams received and the surcharge on them, in all. */
    fun silver(karigarId: String, rows: List<KarigarSilverTransaction>): Silver {
        val mine = newestFirst(rows.filter { it.karigarId == karigarId }) { it.date }
        return Silver(
            rows = mine,
            grams = mine.fold(0.0) { acc, r -> acc + r.silverGrams },
            surcharge = mine.fold(0.0) { acc, r -> acc + r.totalSurcharge },
        )
    }
}

/** The whole answer of /api/karigar/me. */
data class KarigarPortal(
    /** "karigar", "owner" or "none". */
    val role: String,
    /** An owner looking at a karigar's portal (?karigarId=…): read only. */
    val preview: Boolean,
    /** Null when the account is no karigar's ("No work account found"). */
    val karigar: KarigarPortalPerson?,
    val summary: KarigarPortalSummary,
    val jobs: List<KarigarPortalJob>,
    val account: KarigarPortalAccount,
) {
    companion object : Decodable<KarigarPortal> {
        override fun fromMap(m: Map<String, Any?>): KarigarPortal {
            val c = Container(m)
            return KarigarPortal(
                role = c.string("role", ""),
                preview = c.bool("preview", false),
                karigar = c.obj("karigar", KarigarPortalPerson),
                summary = c.obj("summary", KarigarPortalSummary) ?: KarigarPortalSummary(),
                jobs = c.list("jobs", KarigarPortalJob),
                account = c.obj("account", KarigarPortalAccount) ?: KarigarPortalAccount(),
            )
        }
    }
}

data class KarigarPortalPerson(val id: String, val name: String) {
    companion object : Decodable<KarigarPortalPerson> {
        override fun fromMap(m: Map<String, Any?>): KarigarPortalPerson {
            val c = Container(m)
            return KarigarPortalPerson(id = c.string("id", ""), name = c.string("name", ""))
        }
    }
}

/** The three figures at the top: to do, late (7 days or more), urgent (14 or more). */
data class KarigarPortalSummary(
    val active: Int = 0,
    val inProgress: Int = 0,
    val late: Int = 0,
    val critical: Int = 0,
    val oldestDays: Int = 0,
) {
    companion object : Decodable<KarigarPortalSummary> {
        override fun fromMap(m: Map<String, Any?>): KarigarPortalSummary {
            val c = Container(m)
            return KarigarPortalSummary(
                active = c.int("active") ?: 0,
                inProgress = c.int("inProgress") ?: 0,
                late = c.int("late") ?: 0,
                critical = c.int("critical") ?: 0,
                oldestDays = c.int("oldestDays") ?: 0,
            )
        }
    }
}

/** One piece of the karigar's work: off an order, or a stock job. */
data class KarigarPortalJob(
    /** "order:<orderId>:<index>" or "job:<id>": what the server is told to mark done. */
    val id: String,
    /** "order" or "manual". */
    val source: String,
    val description: String,
    val category: String?,
    val metalType: String?,
    val karat: String?,
    val weightG: Double?,
    val quantity: Double?,
    val size: String?,
    val referenceSku: String?,
    val sampleGiven: Boolean,
    /** A picture as a data address ("data:image/jpeg;base64,…"). */
    val sampleImage: String?,
    val plating: String?,
    val orderId: String?,
    /** "pending", "in-progress" or "completed". */
    val status: String,
    val assignedDate: String,
    val ageDays: Int,
    /** "ok", "warning" (7 days) or "critical" (14). */
    val urgency: String,
    /** The making instructions, merged. */
    val notes: String?,
) {
    val isDone: Boolean get() = status == "completed"

    companion object : Decodable<KarigarPortalJob> {
        override fun fromMap(m: Map<String, Any?>): KarigarPortalJob {
            val c = Container(m)
            return KarigarPortalJob(
                id = c.string("id", ""),
                source = c.string("source", ""),
                description = c.string("description", ""),
                category = c.string("category"),
                metalType = c.string("metalType"),
                karat = c.string("karat"),
                weightG = c.double("weightG"),
                quantity = c.double("quantity"),
                size = c.string("size"),
                referenceSku = c.string("referenceSku"),
                sampleGiven = c.bool("sampleGiven", false),
                sampleImage = c.string("sampleImage"),
                plating = c.string("plating"),
                orderId = c.string("orderId"),
                status = c.string("status", "pending"),
                assignedDate = c.string("assignedDate", ""),
                ageDays = c.int("ageDays") ?: 0,
                urgency = c.string("urgency", "ok"),
                notes = c.string("notes"),
            )
        }
    }
}

/** Their own account: the gold they were given and gave back, and what they were paid. */
data class KarigarPortalAccount(
    val goldGiven: Double = 0.0,
    val goldReceived: Double = 0.0,
    /** Still with them. */
    val goldNet: Double = 0.0,
    val totalPaid: Double = 0.0,
    val ledger: List<KarigarPortalGoldLine> = emptyList(),
    val payments: List<KarigarPortalPayment> = emptyList(),
) {
    companion object : Decodable<KarigarPortalAccount> {
        override fun fromMap(m: Map<String, Any?>): KarigarPortalAccount {
            val c = Container(m)
            return KarigarPortalAccount(
                goldGiven = c.double("goldGiven", 0.0),
                goldReceived = c.double("goldReceived", 0.0),
                goldNet = c.double("goldNet", 0.0),
                totalPaid = c.double("totalPaid", 0.0),
                ledger = c.list("ledger", KarigarPortalGoldLine),
                payments = c.list("payments", KarigarPortalPayment),
            )
        }
    }
}

data class KarigarPortalGoldLine(val date: String, val description: String, val goldOut: Double, val goldIn: Double) {
    companion object : Decodable<KarigarPortalGoldLine> {
        override fun fromMap(m: Map<String, Any?>): KarigarPortalGoldLine {
            val c = Container(m)
            return KarigarPortalGoldLine(
                date = c.string("date", ""), description = c.string("description", ""),
                goldOut = c.double("goldOut", 0.0), goldIn = c.double("goldIn", 0.0),
            )
        }
    }
}

data class KarigarPortalPayment(val date: String, val amount: Double, val description: String) {
    companion object : Decodable<KarigarPortalPayment> {
        override fun fromMap(m: Map<String, Any?>): KarigarPortalPayment {
            val c = Container(m)
            return KarigarPortalPayment(date = c.string("date", ""), amount = c.double("amount", 0.0), description = c.string("description", ""))
        }
    }
}

/** The pieces of one order together: a karigar receives work by order (`JobOrderGroup`). */
data class KarigarPortalGroup(
    val key: String,
    /** The order's number; null for a stock piece. */
    val orderId: String?,
    val isStock: Boolean,
    val jobs: List<KarigarPortalJob>,
    /** The oldest piece's age. */
    val ageDays: Int,
    val assignedDate: String,
) {
    val id: String get() = key

    /** The card's own urgency: finished is never urgent; otherwise 14 days critical, 7 a warning. */
    val urgency: String
        get() {
            if (jobs.all { it.isDone }) return "ok"
            return if (ageDays >= 14) "critical" else (if (ageDays >= 7) "warning" else "ok")
        }
}

/** How the page lays the work out: Urgent, Late, In hand, and the finished. */
class KarigarPortalSections(
    val active: List<KarigarPortalJob>,
    val critical: List<KarigarPortalJob>,
    val late: List<KarigarPortalJob>,
    val onTrack: List<KarigarPortalJob>,
    val done: List<KarigarPortalJob>,
)

object KarigarPortalRules {
    /** By order number, then the oldest first (`byOrderThenAge`); a stock piece, with no order, sorts last. */
    private fun byOrderThenAge(a: KarigarPortalJob, b: KarigarPortalJob): Double {
        fun word(j: KarigarPortalJob): String {
            val id = j.orderId ?: ""
            return id.ifEmpty { "zzz" }
        }
        val order = JS.localeCompare(word(a), word(b))
        if (order != 0) return order.toDouble()
        return (b.ageDays - a.ageDays).toDouble()
    }

    fun sections(jobs: List<KarigarPortalJob>): KarigarPortalSections {
        val active = jobs.filter { !it.isDone }
        return KarigarPortalSections(
            active = active,
            critical = active.filter { it.urgency == "critical" }.jsSorted(::byOrderThenAge),
            late = active.filter { it.urgency == "warning" }.jsSorted(::byOrderThenAge),
            onTrack = active.filter { it.urgency == "ok" }.jsSorted(::byOrderThenAge),
            done = jobs.filter { it.isDone },
        )
    }

    /** Pieces under the order they belong to, the oldest group first (`groupJobsByOrder`). A stock piece stands alone. */
    fun groups(jobs: List<KarigarPortalJob>): List<KarigarPortalGroup> {
        class Open(val key: String, val orderId: String?, val isStock: Boolean, val jobs: MutableList<KarigarPortalJob>, var ageDays: Int, val assignedDate: String)

        val order = mutableListOf<String>()
        val open = HashMap<String, Open>()
        for (j in jobs) {
            val orderId = if (j.source == "order" && !(j.orderId ?: "").isEmpty()) j.orderId else null
            val key = if (orderId != null) "order:$orderId" else "job:" + j.id
            val existing = open[key]
            if (existing != null) {
                existing.jobs.add(j)
                existing.ageDays = maxOf(existing.ageDays, j.ageDays)
            } else {
                order.add(key)
                open[key] = Open(key, orderId, j.source == "manual", mutableListOf(j), j.ageDays, j.assignedDate)
            }
        }
        val all = order.mapNotNull { open[it] }.map {
            KarigarPortalGroup(key = it.key, orderId = it.orderId, isStock = it.isStock, jobs = it.jobs.toList(), ageDays = it.ageDays, assignedDate = it.assignedDate)
        }
        return all.jsSorted { a, b -> (b.ageDays - a.ageDays).toDouble() }
    }

    /** One facet of a piece's spec grid. */
    data class Spec(
        val label: String,
        val value: String,
        /** Size and finish are what the bench must get right: drawn apart. */
        val accent: Boolean,
    )

    /** The spec boxes under a piece, in the page's order: Size, Weight, Finish, Type, Karat, Ref, Qty. */
    fun specs(job: KarigarPortalJob): List<Spec> {
        val out = mutableListOf<Spec>()
        job.size?.let { if (it.isNotEmpty()) out.add(Spec("Size", it, true)) }
        job.weightG?.let { if (it != 0.0) out.add(Spec("Weight", JS.number(it) + "g", false)) }
        job.plating?.let { if (it.isNotEmpty()) out.add(Spec("Finish", it, true)) }
        job.category?.let { if (it.isNotEmpty()) out.add(Spec("Type", it, false)) }
        job.karat?.let { if (it.isNotEmpty()) out.add(Spec("Karat", it.uppercase(), false)) }
        job.referenceSku?.let { if (it.isNotEmpty()) out.add(Spec("Ref", it, false)) }
        job.quantity?.let { if (it > 1) out.add(Spec("Qty", JS.number(it), false)) }
        return out
    }

    private val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** date-fns' `dd MMM yyyy` ("05 Oct 2026", or `dd MMM yy` when `shortYear`) on Karachi's day; empty when it does not read. */
    fun date(iso: String, shortYear: Boolean = false): String {
        val d = JS.parseISO(iso) ?: return ""
        val parts = ERPDate.karachiDay(d).split("-").filter { it.isNotEmpty() }.mapNotNull { it.toIntOrNull() }
        if (parts.size != 3 || parts[1] !in 1..12) return ""
        val year = if (shortYear) (parts[0] % 100).toString().padStart(2, '0') else parts[0].toString()
        return parts[2].toString().padStart(2, '0') + " " + months[parts[1] - 1] + " " + year
    }

    /** Grams the way the page prints them: `toFixed(3)` and a g. */
    fun grams(g: Double): String = JS.toFixed(g, 3) + "g"
}
