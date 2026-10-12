package erp.app.screens.workshop

import erp.app.nav.ScreenRegistry
import erp.app.nav.ScreenRoute
import erp.core.ERPDate
import erp.core.logic.KarigarPay
import erp.core.logic.categoryTitle as coreCategoryTitle
import erp.core.logic.awaitingTransfer
import erp.core.logic.describePlating
import erp.core.logic.staticCategories
import erp.core.models.GivenItem
import erp.core.models.GivenItemRecipientType
import erp.core.models.GivenItemStatus
import erp.core.models.HisaabEntityType
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.InvoiceStatus
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.KarigarJob
import erp.core.models.KarigarJobStatus
import erp.core.models.KaratValue
import erp.core.models.MetalType
import erp.core.models.Order
import erp.core.models.OrderStatus
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.util.Locale

// The Workshop's rules, as the screens need them (WorkshopLogic.swift). Plain Kotlin, no views.
//
// workshop.ts (buildWorkshopJobs, groupByKarigar, groupJobsByOrder, formatJobListForShare, mergeInstructions) and
// karigar-position.ts (karigarPosition) are ported line for line below so the board, the karigars list and the
// karigar's page agree with the web to the piece; none of them decides money.

/**
 * One piece of bench work, whether it came off an order, an invoice (a Shopify sale, or a sold piece sent back) or a
 * standalone stock job (src/lib/workshop.ts `WorkshopJob`).
 */
data class WorkshopJob(
    val id: String,
    val source: Source,
    /** [WorkshopLogic.unassigned] when nobody is on it. */
    val karigarId: String,
    val karigarName: String,
    val description: String,
    val status: Status,
    /** ISO; when the work was written up. */
    val assignedDate: String,
    val ageDays: Int,
    val urgency: Urgency,
    val sortTime: Double,
    val orderId: String? = null,
    val invoiceId: String? = null,
    /** Who took the order or wrote the invoice this piece came off. */
    val takenBy: String? = null,
    val isOnline: Boolean = false,
    val itemIndex: Int? = null,
    val customerName: String? = null,
    val category: String? = null,
    val metalType: String? = null,
    val karat: String? = null,
    val weightG: Double? = null,
    val quantity: Double = 1.0,
    val size: String? = null,
    val referenceSku: String? = null,
    /** When the piece physically went to the karigar. Unset until it did. */
    val givenAt: String? = null,
    val plating: String? = null,
    /** The order item's estimate, or the agreed cost on a stock job. */
    val value: Double = 0.0,
    /** The merged instructions (stones, diamonds, the owner's note). */
    val notes: String? = null,
) {
    enum class Source { order, manual, invoice }
    enum class Status { pending, inProgress, completed }
    enum class Urgency { ok, warning, critical }

    val isUnassigned: Boolean get() = karigarId == WorkshopLogic.unassigned
    val isDone: Boolean get() = status == Status.completed
    val hasGiven: Boolean get() = !givenAt.isNullOrEmpty()
}

/** A metal the Assign Stock Work form offers. */
data class WorkshopMetal(val id: String, val title: String)

/** One karigar's whole bench (`KarigarWorkload`): the counts the board and the list show. */
class WorkshopLoad(val karigarId: String, val jobs: List<WorkshopJob>) {
    private val activeJobs = jobs.filter { it.status != WorkshopJob.Status.completed }
    val karigarName: String = jobs.firstOrNull()?.karigarName ?: "Unknown"
    val active: Int = activeJobs.size
    val inProgress: Int = jobs.count { it.status == WorkshopJob.Status.inProgress }
    val completed: Int = jobs.count { it.status == WorkshopJob.Status.completed }

    /** Active jobs 7 days old or more. */
    val overdue: Int = activeJobs.count { it.urgency != WorkshopJob.Urgency.ok }

    /** Active jobs 14 days old or more. */
    val critical: Int = activeJobs.count { it.urgency == WorkshopJob.Urgency.critical }
    val oldestActiveDays: Int = activeJobs.fold(0) { m, j -> maxOf(m, j.ageDays) }
    val totalValue: Double = activeJobs.fold(0.0) { s, j -> s + j.value }
    val totalWeightG: Double = activeJobs.fold(0.0) { s, j -> s + (j.weightG ?: 0.0) }

    val id: String get() = karigarId
    val isUnassigned: Boolean get() = karigarId == WorkshopLogic.unassigned

    /** Late but not yet critical. */
    val late: Int get() = overdue - critical
}

/** Pieces of one order together (`JobOrderGroup`): a karigar receives work by order. */
data class WorkshopOrderGroup(val key: String, val jobs: List<WorkshopJob>, val ageDays: Int)

/** What the whole bench comes to (the board's one-line summary). */
class WorkshopStats(all: List<WorkshopJob>) {
    private val act = all.filter { it.status != WorkshopJob.Status.completed }
    val active: Int = act.size
    val inProgress: Int = act.count { it.status == WorkshopJob.Status.inProgress }
    val overdue: Int = act.count { it.urgency != WorkshopJob.Urgency.ok }
    val critical: Int = act.count { it.urgency == WorkshopJob.Urgency.critical }
    val unassigned: Int = act.count { it.isUnassigned }
    val workers: Int = act.filter { !it.isUnassigned }.map { it.karigarId }.toSet().size
}

// MARK: The board's choices

/** What the board is looking at (the web's `focus`). */
enum class WorkshopFocus(val title: String) {
    all("All work"), unassigned("Unassigned"), attention("Requires attention"), notGiven("Not yet given");

    /** The chip's words (the board's own shorter ones). */
    val chip: String
        get() = when (this) {
            all -> "All work"
            attention -> "Needs attention"
            unassigned -> "Unassigned"
            notGiven -> "To give"
        }
}

/** How the pieces are laid out; the list is where the web opens (workshop/page.tsx `view`). */
enum class WorkshopGrouping(val title: String) { list("List"), karigar("By karigar"), stage("By stage") }

enum class WorkshopStatusFilter(val title: String) {
    active("Active only"), all("All"), pending("Pending"), inProgress("In Progress"), completed("Completed");

    /** The one status this filter asks for, if it names one. */
    val exact: WorkshopJob.Status?
        get() = when (this) {
            pending -> WorkshopJob.Status.pending
            inProgress -> WorkshopJob.Status.inProgress
            completed -> WorkshopJob.Status.completed
            active, all -> null
        }
}

enum class WorkshopTypeFilter(val title: String) { all("All work"), order("Customer orders"), stock("Stock / inventory") }

data class WorkshopFilter(
    val query: String = "",
    val status: WorkshopStatusFilter = WorkshopStatusFilter.active,
    val type: WorkshopTypeFilter = WorkshopTypeFilter.all,
    /** "" is Anyone. */
    val takenBy: String = "",
    /** "" is Everyone. */
    val karigarId: String = "",
) {
    /** While anything narrows the list, an idle karigar means "no match", not "empty bench". */
    val narrowed: Boolean
        get() = query.trim().isNotEmpty() || type != WorkshopTypeFilter.all || status != WorkshopStatusFilter.active || takenBy.isNotEmpty()

    /** The filters behind the toolbar's menu (the search has its own box). */
    val menuCount: Int
        get() = (if (status != WorkshopStatusFilter.active) 1 else 0) + (if (type != WorkshopTypeFilter.all) 1 else 0) +
            (if (takenBy.isEmpty()) 0 else 1) + (if (karigarId.isEmpty()) 0 else 1)
}

/**
 * Everything the board shows, worked out once from the books and the filters
 * (src/app/workshop/page.tsx: benchJobs, filtered, attention, unassignedJobs, notGiven).
 */
class WorkshopSnapshot(val all: List<WorkshopJob>, filter: WorkshopFilter) {
    /** Everything but the karigar filter: the at-a-glance numbers keep showing the whole bench. */
    val bench: List<WorkshopJob> = WorkshopLogic.bench(all, filter)
    val filtered: List<WorkshopJob> = if (filter.karigarId.isEmpty()) bench else bench.filter { it.karigarId == filter.karigarId }
    val attention: List<WorkshopJob> =
        filtered.filter { it.status != WorkshopJob.Status.completed && (it.urgency != WorkshopJob.Urgency.ok || it.isUnassigned) }

    // Deliberately ignores the karigar filter: "work with nobody on it" would always come up empty.
    val unassignedJobs: List<WorkshopJob> = bench
        .filter { it.status != WorkshopJob.Status.completed && it.isUnassigned }
        .withIndex().sortedWith(compareByDescending<IndexedValue<WorkshopJob>> { it.value.ageDays }.thenBy { it.index }).map { it.value }

    // Assigned to somebody, not done, and not yet handed over: still in the safe.
    val notGiven: List<WorkshopJob> = filtered.filter { it.status != WorkshopJob.Status.completed && !it.isUnassigned && !it.hasGiven }
    val stats = WorkshopStats(all)

    fun focused(focus: WorkshopFocus): List<WorkshopJob> = when (focus) {
        WorkshopFocus.all -> filtered
        WorkshopFocus.unassigned -> unassignedJobs
        WorkshopFocus.attention -> attention
        WorkshopFocus.notGiven -> notGiven
    }

    fun count(focus: WorkshopFocus): Int = when (focus) {
        WorkshopFocus.all -> filtered.count { it.status != WorkshopJob.Status.completed }
        WorkshopFocus.unassigned -> unassignedJobs.size
        WorkshopFocus.attention -> attention.size
        WorkshopFocus.notGiven -> notGiven.size
    }
}

// MARK: The rules

object WorkshopLogic {
    const val warnDays = 7
    const val criticalDays = 14
    const val unassigned = "__unassigned__"

    // MARK: Age

    /** Whole days since an instant; 0 for a missing or future one (`daysSince`). */
    fun daysSince(iso: String?, now: Instant = Instant.now()): Int {
        val d = ERPDate.parse(iso) ?: return 0
        val days = Math.floor((now.toEpochMilli() - d.toEpochMilli()) / 1000.0 / 86400)
        return if (days > 0) days.toInt() else 0
    }

    fun urgency(status: WorkshopJob.Status, ageDays: Int): WorkshopJob.Urgency {
        if (status == WorkshopJob.Status.completed) return WorkshopJob.Urgency.ok
        if (ageDays >= criticalDays) return WorkshopJob.Urgency.critical
        if (ageDays >= warnDays) return WorkshopJob.Urgency.warning
        return WorkshopJob.Urgency.ok
    }

    // MARK: Words from categories.ts

    /** A category id as its list name; null when unknown. */
    fun categoryTitle(id: String?): String? {
        if (id.isNullOrEmpty()) return null
        return coreCategoryTitle(id)
    }

    /** Karat only means something for gold (`displayKarat`): silver and platinum carry a leftover default. */
    fun displayKarat(metal: MetalType?, karat: KaratValue?): String? {
        if (karat == null || metal != MetalType.gold) return null
        return karat.rawValue
    }

    // MARK: Instructions

    /** One instruction block per item: blank and duplicate lines dropped (`mergeInstructions`). */
    fun mergeInstructions(raws: List<String?>): String? {
        val seen = HashSet<String>()
        val parts = ArrayList<String>()
        for (raw in raws) {
            val v = (raw ?: "").trim()
            if (v.isEmpty() || v in seen) continue
            seen.add(v)
            parts.add(v)
        }
        return if (parts.isEmpty()) null else parts.joinToString("\n")
    }

    // MARK: Building the list (buildWorkshopJobs)

    private fun realKarigar(id: String?): String = if (id.isNullOrEmpty() || id == "none") "" else id

    private fun said(name: String?, fallback: String): String {
        val n = (name ?: "").trim()
        return if (n.isEmpty()) fallback else n
    }

    private fun nonEmpty(s: String?): String? = if (s.isNullOrEmpty()) null else s

    /**
     * Orders, standalone stock jobs and invoices flattened into one list. Cancelled and refunded orders are dead work;
     * an order already invoiced is delivered; an online order whose transfer is not in is not work yet. Pending orders
     * are in: handing out a karigar is what moves them on.
     */
    fun buildJobs(
        orders: List<Order>,
        karigarJobs: List<KarigarJob>,
        karigars: List<Karigar>,
        invoices: List<Invoice>,
        now: Instant = Instant.now(),
    ): List<WorkshopJob> {
        val nameById = HashMap<String, String>()
        for (k in karigars) nameById[k.id] = k.name
        val out = ArrayList<WorkshopJob>()
        for (order in orders) out.addAll(orderJobs(order, nameById, now))
        for (job in karigarJobs) out.add(manualJob(job, nameById, now))
        for (inv in invoices) out.addAll(invoiceJobs(inv, nameById, now))
        return ordered(out)
    }

    private fun job(
        id: String, source: WorkshopJob.Source, karigarId: String, karigarName: String, description: String,
        status: WorkshopJob.Status, assignedDate: String, now: Instant,
        fill: (WorkshopJob) -> WorkshopJob,
    ): WorkshopJob {
        val age = daysSince(assignedDate, now)
        val base = WorkshopJob(
            id = id, source = source, karigarId = karigarId, karigarName = karigarName, description = description,
            status = status, assignedDate = assignedDate, ageDays = age, urgency = urgency(status, age),
            sortTime = ERPDate.parse(assignedDate)?.let { it.toEpochMilli() / 1000.0 } ?: 0.0,
        )
        return fill(base)
    }

    private fun orderJobs(order: Order, nameById: Map<String, String>, now: Instant): List<WorkshopJob> {
        if (order.status == OrderStatus.cancelled || order.status == OrderStatus.refunded) return emptyList()
        if (!order.invoiceId.isNullOrEmpty()) return emptyList()
        if (awaitingTransfer(order)) return emptyList()
        val out = ArrayList<WorkshopJob>()
        order.items.forEachIndexed { idx, item ->
            val raw = realKarigar(item.karigarId)
            // An order marked Completed means the work is done, even if no piece was ticked one by one.
            val finished = item.isCompleted || order.status == OrderStatus.completed
            val status = if (finished) WorkshopJob.Status.completed else if (order.status == OrderStatus.inProgress) WorkshopJob.Status.inProgress else WorkshopJob.Status.pending
            out.add(
                job(
                    "order:${order.id}:$idx", WorkshopJob.Source.order, raw.ifEmpty { unassigned },
                    if (raw.isEmpty()) "Unassigned" else (nameById[raw] ?: "Unknown karigar"),
                    said(item.description, "Item"), status, order.createdAt, now,
                ) {
                    it.copy(
                        orderId = order.id,
                        takenBy = order.takenBy,
                        itemIndex = idx,
                        customerName = said(order.customerName, "Walk-in"),
                        category = categoryTitle(item.itemCategory),
                        metalType = item.metalType.rawValue,
                        karat = displayKarat(item.metalType, item.karat),
                        weightG = item.estimatedWeightG,
                        size = nonEmpty(item.size),
                        referenceSku = nonEmpty(item.referenceSku),
                        givenAt = nonEmpty(item.givenAt),
                        plating = describePlating(item),
                        value = item.totalEstimate ?: 0.0,
                        notes = mergeInstructions(listOf(item.stoneDetails, item.diamondDetails, item.adminNote)),
                    )
                },
            )
        }
        return out
    }

    private fun manualJob(job: KarigarJob, nameById: Map<String, String>, now: Instant): WorkshopJob {
        val raw = job.karigarId
        val status = when (job.status) {
            KarigarJobStatus.completed -> WorkshopJob.Status.completed
            KarigarJobStatus.inProgress -> WorkshopJob.Status.inProgress
            else -> WorkshopJob.Status.pending
        }
        return job(
            "job:${job.id}", WorkshopJob.Source.manual, raw.ifEmpty { unassigned },
            if (raw.isEmpty()) "Unassigned" else (nameById[raw] ?: said(job.karigarName, "Unknown karigar")),
            job.description, status, job.assignedDate, now,
        ) {
            it.copy(
                givenAt = nonEmpty(job.givenAt),
                category = categoryTitle(job.itemCategory) ?: nonEmpty(job.itemCategory),
                metalType = job.metalType?.rawValue,
                karat = displayKarat(job.metalType, job.karat),
                weightG = job.weightG,
                quantity = job.quantity ?: 1.0,
                size = nonEmpty(job.size),
                value = job.agreedCost ?: 0.0,
                notes = mergeInstructions(listOf(job.notes)),
            )
        }
    }

    /**
     * Sold pieces that still need bench work: Shopify sales (which arrive as invoices) while unfulfilled, and any
     * invoice line someone has deliberately given to a karigar (a resize, a replate, a repair).
     */
    private fun invoiceJobs(inv: Invoice, nameById: Map<String, String>, now: Instant): List<WorkshopJob> {
        if (inv.status == InvoiceStatus.refunded) return emptyList()
        val fulfilment = (inv.shopifyFulfillment ?: "").lowercase(Locale.ROOT)
        val fromShopify = (inv.source ?: "").startsWith("shopify") && (inv.shopifyCancelledAt ?: "").isEmpty()
        // The explicit field first; the notes are the legacy path for invoices imported before it existed.
        val unfulfilled = if (fulfilment.isEmpty()) (inv.notes ?: "").contains("unfulfilled", ignoreCase = true) else fulfilment != "fulfilled"
        val isOnline = fromShopify && unfulfilled
        val out = ArrayList<WorkshopJob>()
        inv.items.forEachIndexed { idx, item ->
            val assigned = realKarigar(item.karigarId)
            // Only online sales come in by themselves; everything else appears once it has been handed to someone.
            if (!isOnline && assigned.isEmpty()) return@forEachIndexed
            if (item.isCompleted) return@forEachIndexed
            out.add(
                job(
                    "invoice:${inv.id}:$idx", WorkshopJob.Source.invoice, assigned.ifEmpty { unassigned },
                    if (assigned.isEmpty()) "Unassigned" else (nameById[assigned] ?: "Unknown karigar"),
                    said(item.name, "Item"), WorkshopJob.Status.pending, inv.createdAt, now,
                ) {
                    it.copy(
                        givenAt = nonEmpty(item.givenAt),
                        invoiceId = inv.id,
                        takenBy = inv.takenBy,
                        isOnline = isOnline,
                        itemIndex = idx,
                        customerName = said(inv.customerName, "Walk-in"),
                        category = categoryTitle(item.itemCategory),
                        metalType = item.metalType.rawValue,
                        karat = displayKarat(item.metalType, item.karat),
                        plating = describePlating(item),
                        weightG = item.metalWeightG,
                        quantity = item.quantity,
                        size = nonEmpty(item.size),
                        value = item.itemTotal,
                        notes = mergeInstructions(listOf(item.stoneDetails, item.diamondDetails, item.adminNote)),
                    )
                },
            )
        }
        return out
    }

    /** Newest-assigned first, but completed work to the bottom. (Ties keep the order they came in.) */
    private fun ordered(jobs: List<WorkshopJob>): List<WorkshopJob> =
        jobs.withIndex().sortedWith { a, b ->
            val aDone = a.value.status == WorkshopJob.Status.completed
            val bDone = b.value.status == WorkshopJob.Status.completed
            when {
                aDone != bDone -> if (!aDone) -1 else 1
                a.value.sortTime != b.value.sortTime -> if (a.value.sortTime > b.value.sortTime) -1 else 1
                else -> a.index.compareTo(b.index)
            }
        }.map { it.value }

    // MARK: Filtering

    /** Search, Taken by, status and type, but not the karigar (the board's `benchJobs`). */
    fun bench(all: List<WorkshopJob>, f: WorkshopFilter): List<WorkshopJob> {
        val q = f.query.trim().lowercase(Locale.ROOT)
        return all.filter { j ->
            if (f.status == WorkshopStatusFilter.active && j.status == WorkshopJob.Status.completed) return@filter false
            val want = f.status.exact
            if (want != null && j.status != want) return@filter false
            if (f.takenBy.isNotEmpty() && j.takenBy != f.takenBy) return@filter false
            if (f.type == WorkshopTypeFilter.order && j.source != WorkshopJob.Source.order) return@filter false
            if (f.type == WorkshopTypeFilter.stock && j.source != WorkshopJob.Source.manual) return@filter false
            if (q.isEmpty()) true else matches(j, q)
        }
    }

    private fun matches(j: WorkshopJob, q: String): Boolean =
        listOf(j.description, j.karigarName, j.customerName, j.orderId, j.invoiceId, j.category).any { it != null && it.lowercase(Locale.ROOT).contains(q) }

    // MARK: Grouping

    /** Per karigar, the most at-risk first, Unassigned pinned on top (`groupByKarigar`). */
    fun groupByKarigar(jobs: List<WorkshopJob>): List<WorkshopLoad> {
        val order = ArrayList<String>()
        val lists = HashMap<String, MutableList<WorkshopJob>>()
        for (j in jobs) {
            if (lists[j.karigarId] == null) {
                order.add(j.karigarId)
                lists[j.karigarId] = ArrayList()
            }
            lists[j.karigarId]!!.add(j)
        }
        val loads = order.map { WorkshopLoad(it, lists[it] ?: emptyList()) }
        return loads.withIndex().sortedWith { a, b ->
            val x = a.value
            val y = b.value
            when {
                x.isUnassigned != y.isUnassigned -> if (x.isUnassigned) -1 else 1
                x.critical != y.critical -> if (x.critical > y.critical) -1 else 1
                x.overdue != y.overdue -> if (x.overdue > y.overdue) -1 else 1
                x.active != y.active -> if (x.active > y.active) -1 else 1
                else -> a.index.compareTo(b.index)
            }
        }.map { it.value }
    }

    /**
     * Pieces under the order they belong to, the oldest group first (`groupJobsByOrder`). Stock work has no order, so
     * each stock piece stands alone.
     */
    fun groupJobsByOrder(jobs: List<WorkshopJob>): List<WorkshopOrderGroup> {
        val keys = ArrayList<String>()
        val lists = HashMap<String, MutableList<WorkshopJob>>()
        val ages = HashMap<String, Int>()
        for (j in jobs) {
            val key = when {
                j.source == WorkshopJob.Source.order && j.orderId != null -> "order:${j.orderId}"
                j.source == WorkshopJob.Source.invoice && j.invoiceId != null -> "invoice:${j.invoiceId}"
                else -> "job:${j.id}"
            }
            if (lists[key] == null) {
                keys.add(key)
                lists[key] = ArrayList()
            }
            lists[key]!!.add(j)
            ages[key] = maxOf(ages[key] ?: 0, j.ageDays)
        }
        val groups = keys.map { WorkshopOrderGroup(it, lists[it] ?: emptyList(), ages[it] ?: 0) }
        return groups.withIndex().sortedWith { a, b ->
            if (a.value.ageDays != b.value.ageDays) (if (a.value.ageDays > b.value.ageDays) -1 else 1) else a.index.compareTo(b.index)
        }.map { it.value }
    }

    /** The pieces ordered so an order's pieces sit together. */
    fun byOrder(jobs: List<WorkshopJob>): List<WorkshopJob> = groupJobsByOrder(jobs).flatMap { it.jobs }

    // MARK: Pay batches (karigars/page.tsx activeHisaabMap, karigars/[id]/page.tsx openBatch)

    /**
     * Each karigar's open pay batch, by karigar id: a batch with no `closedDate` is still open (core's
     * KarigarPay.isOpen, lib/karigar-pay.ts), and a karigar normally has one (the newest is taken if he has more).
     */
    fun openBatches(batches: List<KarigarBatch>): Map<String, KarigarBatch> {
        val out = LinkedHashMap<String, KarigarBatch>()
        for (b in batches) {
            if (!KarigarPay.isOpen(b)) continue
            val have = out[b.karigarId]
            if (have != null && startTime(have) >= startTime(b)) continue
            out[b.karigarId] = b
        }
        return out
    }

    private fun startTime(b: KarigarBatch): Double = ERPDate.parse(b.startDate)?.let { it.toEpochMilli() / 1000.0 } ?: 0.0

    // MARK: What a piece's write names (the ERP's ops)

    /**
     * Where a piece on the bench is kept, so the right write changes it: an order's piece, an invoice's piece, or a
     * stock job (its karigar_jobs id, the board's id without "job:"). Null for a piece with neither.
     */
    sealed interface WriteTarget {
        data class Order(val id: String, val index: Int) : WriteTarget
        data class Invoice(val id: String, val index: Int) : WriteTarget
        data class Stock(val id: String) : WriteTarget
    }

    fun writeTarget(job: WorkshopJob): WriteTarget? = when (job.source) {
        WorkshopJob.Source.order -> {
            val id = job.orderId
            val i = job.itemIndex
            if (id == null || i == null) null else WriteTarget.Order(id, i)
        }
        WorkshopJob.Source.invoice -> {
            val id = job.invoiceId
            val i = job.itemIndex
            if (id == null || i == null) null else WriteTarget.Invoice(id, i)
        }
        WorkshopJob.Source.manual ->
            if (!job.id.startsWith("job:")) null else job.id.drop(4).let { if (it.isEmpty()) null else WriteTarget.Stock(it) }
    }

    /** The categories the Assign Stock Work form offers, in the list's order (categories.ts staticCategories). */
    val categoryIds: List<String> get() = staticCategories.map { it.id }.sorted()

    /** The Assign Stock Work form's metals, its words for them. */
    val stockMetals: List<WorkshopMetal> = listOf(
        WorkshopMetal("gold", "Gold"), WorkshopMetal("silver", "Silver"),
        WorkshopMetal("platinum", "Platinum"), WorkshopMetal("palladium", "Palladium"),
    )

    // MARK: Words

    /** C's `%.nf`: the exact value, a tie going to the even digit. */
    fun fixed(x: Double, digits: Int): String {
        if (x.isNaN()) return "nan"
        if (x.isInfinite()) return if (x < 0) "-inf" else "inf"
        val text = BigDecimal(Math.abs(x)).setScale(digits, RoundingMode.HALF_EVEN).toPlainString()
        return if (x < 0 || (x == 0.0 && 1.0 / x < 0)) "-$text" else text
    }

    /** 3.5, 12, 0.125: no trailing zeros, at most three places. */
    fun number(x: Double, digits: Int = 3): String {
        var s = fixed(x, digits)
        if (s.contains('.')) {
            s = s.trimEnd('0')
            if (s.endsWith(".")) s = s.dropLast(1)
        }
        return s
    }

    fun grams(g: Double): String = number(g) + "g"

    /** The grams to three places, as the karigar's page and the gold khata say them. */
    fun grams3(g: Double): String = fixed(g, 3) + "g"

    /** Swift's `.rounded()`: a half goes away from zero. */
    fun roundedAway(x: Double): Double = BigDecimal(x).setScale(0, RoundingMode.HALF_UP).toDouble()

    /** "Size 12 · 3.5g · 21K · Ref RG-1": what to know about the piece in one line. */
    fun meta(j: WorkshopJob): String {
        val parts = ArrayList<String>()
        j.category?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
        j.size?.takeIf { it.isNotEmpty() }?.let { parts.add("Size $it") }
        j.plating?.takeIf { it.isNotEmpty() }?.let { parts.add(it) }
        j.weightG?.takeIf { it > 0 }?.let { parts.add(grams(it)) }
        j.karat?.takeIf { it.isNotEmpty() }?.let { parts.add(it.uppercase()) }
        j.referenceSku?.takeIf { it.isNotEmpty() }?.let { parts.add("Ref $it") }
        return parts.joinToString(" · ")
    }

    /** "5 pieces" / "1 piece". */
    fun pieces(n: Int): String = "$n piece${if (n == 1) "" else "s"}"

    /** The plain-text work list for a karigar, WhatsApp friendly (`formatJobListForShare`). */
    fun shareText(load: WorkshopLoad, shopName: String): String {
        val active = load.jobs.filter { it.status != WorkshopJob.Status.completed }
        val lines = arrayListOf(
            "*$shopName — Work List*",
            "*${load.karigarName}*",
            "${active.size} pending item${if (active.size == 1) "" else "s"}",
            "",
        )
        if (active.isEmpty()) {
            lines.add("No pending work. ✅")
            return lines.joinToString("\n")
        }
        val oldestFirst = active.withIndex().sortedWith { a, b ->
            if (a.value.ageDays != b.value.ageDays) (if (a.value.ageDays > b.value.ageDays) -1 else 1) else a.index.compareTo(b.index)
        }.map { it.value }
        oldestFirst.forEachIndexed { i, j ->
            val flag = if (j.urgency == WorkshopJob.Urgency.critical) " 🔴" else if (j.urgency == WorkshopJob.Urgency.warning) " ⚠️" else ""
            lines.add("${i + 1}. ${j.description}$flag")
            val facts = ArrayList<String>()
            j.category?.takeIf { it.isNotEmpty() }?.let { facts.add(it) }
            j.weightG?.takeIf { it > 0 }?.let { facts.add("${number(it)}g") }
            j.karat?.takeIf { it.isNotEmpty() }?.let { facts.add(it.uppercase()) }
            if (facts.isNotEmpty()) lines.add("   " + facts.joinToString(" · "))
            j.orderId?.let { o ->
                val who = if ((j.customerName ?: "").isEmpty()) "" else " (${j.customerName})"
                lines.add("   Order $o$who")
            }
            lines.add("   ${j.ageDays} day${if (j.ageDays == 1) "" else "s"} since given")
        }
        return lines.joinToString("\n")
    }

    // MARK: Paths

    /** An id as one path piece ("KAR-1", or a name with odd characters in it): letters and digits stay, "-_.~" too. */
    fun piece(id: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < id.length) {
            val cp = id.codePointAt(i)
            val n = Character.charCount(cp)
            if (Character.isLetterOrDigit(cp) || (cp < 128 && cp.toChar() in "-_.~")) {
                out.appendCodePoint(cp)
            } else {
                for (b in String(Character.toChars(cp)).toByteArray(Charsets.UTF_8)) out.append('%').append(String.format(Locale.ROOT, "%02X", b.toInt() and 0xFF))
            }
            i += n
        }
        return out.toString()
    }

    fun karigarPath(id: String): String = "/karigars/" + piece(id)

    /**
     * "/karigars/KAR-1" is the karigar "KAR-1". Null for the list, for "add" (the karigar form's), for a deeper page
     * (".../edit" is [karigarEditId]'s) and for a path that asks for the ERP's page with "?web=1".
     */
    fun karigarId(fromPath: String): String? {
        if (ScreenRegistry.wantsWeb(fromPath)) return null
        val prefix = "/karigars/"
        val bare = ScreenRoute.bare(fromPath)
        if (!bare.startsWith(prefix)) return null
        val rest = bare.drop(prefix.length)
        if (rest.isEmpty() || rest.contains('/') || rest == "add") return null
        return ScreenRoute.percentDecode(rest)
    }

    /** "/karigars/KAR-1/edit" is the edit form of the karigar "KAR-1". Null for any other path, and for "?web=1". */
    fun karigarEditId(fromPath: String): String? {
        if (ScreenRegistry.wantsWeb(fromPath)) return null
        val prefix = "/karigars/"
        val suffix = "/edit"
        val bare = ScreenRoute.bare(fromPath)
        if (!bare.startsWith(prefix) || !bare.endsWith(suffix) || bare.length < prefix.length + suffix.length) return null
        val rest = bare.drop(prefix.length).dropLast(suffix.length)
        if (rest.isEmpty() || rest.contains('/')) return null
        return ScreenRoute.percentDecode(rest)
    }

    /** True when `path` is exactly this page, with or without a query, and does not ask for the ERP's own. */
    fun isPage(path: String, page: String): Boolean = ScreenRoute.bare(path) == page && !ScreenRegistry.wantsWeb(path)

    /** One value from a path's query ("/workshop?karigar=KAR-1"). */
    fun queryValue(name: String, path: String): String? {
        val noHash = path.substringBefore('#')
        if (!noHash.contains('?')) return null
        for (pair in noHash.substringAfter('?').split('&')) {
            if (pair.isEmpty()) continue
            val key = ScreenRoute.percentDecode(pair.substringBefore('='))
            if (key == name) return if (pair.contains('=')) ScreenRoute.percentDecode(pair.substringAfter('=')) else null
        }
        return null
    }

    /** A number to dial: digits and a leading plus, nothing else. */
    fun dialable(phone: String): String = phone.filter { it.code < 128 && (it.isDigit() || it == '+') }

    /** "1 Oct 2026" (date-fns 'd MMM yyyy', the web's ledger rows) in Karachi; "" when it does not read. */
    fun shortDate(iso: String?): String {
        val d = ERPDate.parse(iso) ?: return ""
        return java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy", Locale.US).withZone(ERPDate.karachi).format(d)
    }
}

// MARK: One karigar's position with the shop (karigar-position.ts)

/**
 * His bench, the metal on it, the gold khata, the given items still out with him and his hisaab cash. Read only. Two
 * measures of metal, never added: what the pieces will weigh (the estimates typed on the jobs) and what was actually
 * handed over and returned (the khata).
 */
class WorkshopPosition(
    karigarId: String,
    karigarName: String,
    jobs: List<WorkshopJob>,
    givenItems: List<GivenItem>,
    hisaab: List<HisaabEntry>,
) {
    data class Metal(val label: String, val grams: Double)

    val bench: List<WorkshopJob>
    val metals: List<Metal>
    val unweighed: Int
    val khataGiven: Double
    val khataBack: Double

    /** Positive: he holds the shop's money (an advance). Negative: the shop owes him. */
    val cashBalance: Double
    val given: List<GivenItem>

    val khataNet: Double get() = khataGiven - khataBack

    init {
        val mine = jobs
            .filter { it.karigarId == karigarId && it.status != WorkshopJob.Status.completed }
            .withIndex()
            .sortedWith { a, b -> if (a.value.ageDays != b.value.ageDays) (if (a.value.ageDays > b.value.ageDays) -1 else 1) else a.index.compareTo(b.index) }
            .map { it.value }
        val labels = ArrayList<String>()
        val weights = HashMap<String, Double>()
        var none = 0
        for (j in mine) {
            val w = j.weightG ?: 0.0
            if (w <= 0) {
                none += 1
                continue
            }
            val metal = if ((j.metalType ?: "").isEmpty()) "metal" else (j.metalType ?: "metal")
            val key = listOf(metal, j.karat ?: "").filter { it.isNotEmpty() }.joinToString(" ")
            if (weights[key] == null) labels.add(key)
            weights[key] = (weights[key] ?: 0.0) + w
        }
        val rows = hisaab.filter { it.entityType == HisaabEntityType.karigar && it.entityId == karigarId }
        bench = mine
        metals = labels.map { Metal(it, weights[it] ?: 0.0) }
        unweighed = none
        khataGiven = rows.fold(0.0) { s, r -> s + r.goldDebitGrams }
        khataBack = rows.fold(0.0) { s, r -> s + r.goldCreditGrams }
        cashBalance = rows.fold(0.0) { s, r -> s + r.cashDebit - r.cashCredit }
        val wanted = norm(karigarName)
        given = givenItems.filter { g ->
            if (g.status != GivenItemStatus.out) return@filter false
            val rid = g.recipientId
            if (!rid.isNullOrEmpty()) rid == karigarId else g.recipientType == GivenItemRecipientType.karigar && norm(g.recipientName) == wanted
        }
    }

    companion object {
        /** Names compared the way lib/given.ts does: trimmed, spaces collapsed, case ignored. */
        fun norm(s: String): String = s.split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ").lowercase(Locale.ROOT)
    }
}

/** A figure typed in a form: digits and one dot (the web's number box), `places` decimals at most. Null when empty. */
object WorkshopFigure {
    /** `MoneyParse.amount`: only digits and the first dot count, so "PKR 1,25,000" is 125000. */
    fun read(raw: String, places: Int = 3): Double? {
        val out = StringBuilder()
        var seenDot = false
        var decimals = 0
        for (ch in raw) {
            if (ch in '0'..'9') {
                if (seenDot) {
                    if (decimals >= places) continue
                    decimals += 1
                }
                out.append(ch)
            } else if (ch == '.' && !seenDot) {
                seenDot = true
                out.append(ch)
            }
        }
        if (out.isEmpty() || out.toString() == ".") return null
        return out.toString().toDoubleOrNull()
    }

    /** A stored figure for a field: no trailing zeros, nothing for none. */
    fun field(v: Double?): String {
        if (v == null || v == 0.0) return ""
        return WorkshopLogic.number(v)
    }
}

/** A karigar who is on the books: removal hides (`deletedAt`), as the web store's live list does. */
fun workshopLive(karigars: List<Karigar>): List<Karigar> = karigars.filter { it.deletedAt.isNullOrEmpty() }
