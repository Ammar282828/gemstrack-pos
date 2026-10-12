package erp.app.screens.workshop

import erp.core.ERPDecode
import erp.core.models.GivenItem
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.KarigarJob
import erp.core.models.Order
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// WorkshopLogic (workshop.ts, karigar-position.ts) on made-up books: which pieces are on the bench, who they are
// with, how old, in what order, and what the board's choices narrow them to.
class WorkshopLogicTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private fun days(n: Int): String = now.minusSeconds(n * 86_400L + 60).toString()

    private fun karigar(id: String, name: String) = ERPDecode.model<Karigar>(mapOf("id" to id, "name" to name, "contact" to "0300 0000000"))!!

    private fun order(id: String, status: String, ago: Int, items: List<Map<String, Any?>>, extra: Map<String, Any?> = emptyMap()): Order =
        ERPDecode.model<Order>(
            mapOf("id" to id, "status" to status, "createdAt" to days(ago), "items" to items, "customerName" to "Demo Customer", "takenBy" to "Ammar") + extra,
        )!!

    private fun piece(desc: String, karigarId: String? = null, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("description" to desc, "metalType" to "gold", "karat" to "21k", "estimatedWeightG" to 4.5, "totalEstimate" to 50000) +
            (if (karigarId != null) mapOf("karigarId" to karigarId) else emptyMap()) + extra

    private fun invoice(id: String, ago: Int, items: List<Map<String, Any?>>, extra: Map<String, Any?> = emptyMap()): Invoice =
        ERPDecode.model<Invoice>(mapOf("id" to id, "createdAt" to days(ago), "items" to items, "customerName" to "Demo Buyer") + extra)!!

    private fun line(name: String, karigarId: String? = null, extra: Map<String, Any?> = emptyMap()): Map<String, Any?> =
        mapOf("name" to name, "metalType" to "silver", "metalWeightG" to 12.0, "itemTotal" to 9000, "quantity" to 1) +
            (if (karigarId != null) mapOf("karigarId" to karigarId) else emptyMap()) + extra

    private fun stock(id: String, karigarId: String, status: String = "pending", ago: Int = 1, extra: Map<String, Any?> = emptyMap()): KarigarJob =
        ERPDecode.model<KarigarJob>(
            mapOf("id" to id, "karigarId" to karigarId, "karigarName" to "Old Name", "description" to "Stacked rings", "status" to status, "assignedDate" to days(ago), "weightG" to 3.0, "agreedCost" to 1500) + extra,
        )!!

    private val karigars = listOf(karigar("K1", "Ustad Demo"), karigar("K2", "Karigar Example"))

    private fun build(orders: List<Order> = emptyList(), jobs: List<KarigarJob> = emptyList(), invoices: List<Invoice> = emptyList()) =
        WorkshopLogic.buildJobs(orders, jobs, karigars, invoices, now)

    // MARK: The list

    @Test fun deadAndDeliveredOrdersAreNotWork() {
        val jobs = build(
            orders = listOf(
                order("O1", "Cancelled", 3, listOf(piece("a"))),
                order("O2", "Refunded", 3, listOf(piece("b"))),
                order("O3", "Pending", 3, listOf(piece("c")), mapOf("invoiceId" to "INV-1")),
                order("O4", "Pending", 3, listOf(piece("d")), mapOf("website" to mapOf("paymentStatus" to "awaiting_transfer"))),
                order("O5", "Pending", 3, listOf(piece("e"))),
            ),
        )
        assertEquals(listOf("order:O5:0"), jobs.map { it.id })
    }

    @Test fun anOrderPieceCarriesWhatTheBoardShows() {
        val j = build(orders = listOf(order("O1", "In Progress", 9, listOf(piece("Bangle", "K1", mapOf("givenAt" to days(2), "stoneDetails" to " ruby ", "adminNote" to "ruby", "size" to "2.4")))))).single()
        assertEquals(WorkshopJob.Status.inProgress, j.status)
        assertEquals("Ustad Demo", j.karigarName)
        assertEquals(9, j.ageDays)
        assertEquals(WorkshopJob.Urgency.warning, j.urgency)
        assertEquals("ruby", j.notes) // blank and duplicate lines dropped
        assertEquals("Demo Customer", j.customerName)
        assertEquals("Ammar", j.takenBy)
        assertEquals("21k", j.karat)
        assertEquals(50000.0, j.value)
        assertTrue(j.hasGiven)
        assertEquals("Size 2.4 · 4.5g · 21K", WorkshopLogic.meta(j))
        assertEquals(WorkshopLogic.WriteTarget.Order("O1", 0), WorkshopLogic.writeTarget(j))
    }

    @Test fun anUnassignedPieceNamesNobody() {
        val j = build(orders = listOf(order("O1", "Pending", 0, listOf(piece("Band", "none"))))).single()
        assertTrue(j.isUnassigned)
        assertEquals("Unassigned", j.karigarName)
        assertEquals(WorkshopJob.Urgency.ok, j.urgency)
    }

    @Test fun aCompletedOrderIsDoneEvenIfNoPieceWasTicked() {
        val j = build(orders = listOf(order("O1", "Completed", 20, listOf(piece("Band", "K1"))))).single()
        assertTrue(j.isDone)
        // Done work is never urgent, however old.
        assertEquals(WorkshopJob.Urgency.ok, j.urgency)
    }

    @Test fun silverAndPlatinumLoseTheirLeftoverKarat() {
        val j = build(orders = listOf(order("O1", "Pending", 0, listOf(piece("Band", extra = mapOf("metalType" to "silver")))))).single()
        assertNull(j.karat)
    }

    @Test fun stockJobsKeepTheirKarigarAndTakeTheNameOnFile() {
        val jobs = build(jobs = listOf(stock("J1", "K1"), stock("J2", "GONE", "in-progress")))
        assertEquals(listOf("job:J1", "job:J2"), jobs.map { it.id }.sorted())
        val a = jobs.first { it.id == "job:J1" }
        val b = jobs.first { it.id == "job:J2" }
        assertEquals("Ustad Demo", a.karigarName)
        // A karigar no longer on the books keeps the name the job was written with.
        assertEquals("Old Name", b.karigarName)
        assertEquals(WorkshopJob.Status.inProgress, b.status)
        assertEquals(1500.0, a.value)
        assertEquals(WorkshopLogic.WriteTarget.Stock("J1"), WorkshopLogic.writeTarget(a))
    }

    @Test fun soldPiecesComeOnlyWhenOnlineOrHandedToSomeone() {
        val jobs = build(
            invoices = listOf(
                invoice("I1", 2, listOf(line("walk-in sale"))),
                invoice("I2", 2, listOf(line("resize", "K1"), line("other"))),
                invoice("SHOPIFY-1", 2, listOf(line("online piece")), mapOf("source" to "shopify_import", "shopifyFulfillment" to "unfulfilled")),
                invoice("SHOPIFY-2", 2, listOf(line("shipped")), mapOf("source" to "shopify_import", "shopifyFulfillment" to "fulfilled")),
                invoice("SHOPIFY-3", 2, listOf(line("legacy online")), mapOf("source" to "shopify_import", "notes" to "Imported. UNFULFILLED")),
                invoice("I3", 2, listOf(line("refunded", "K1")), mapOf("status" to "Refunded")),
                invoice("I4", 2, listOf(line("finished", "K1", mapOf("isCompleted" to true)))),
            ),
        )
        assertEquals(listOf("invoice:I2:0", "invoice:SHOPIFY-1:0", "invoice:SHOPIFY-3:0"), jobs.map { it.id }.sorted())
        assertTrue(jobs.first { it.id == "invoice:SHOPIFY-1:0" }.isOnline)
        assertTrue(jobs.first { it.id == "invoice:SHOPIFY-1:0" }.isUnassigned)
        assertFalse(jobs.first { it.id == "invoice:I2:0" }.isOnline)
        assertEquals(WorkshopLogic.WriteTarget.Invoice("I2", 0), WorkshopLogic.writeTarget(jobs.first { it.id == "invoice:I2:0" }))
    }

    @Test fun newestFirstDoneLastTiesInOrder() {
        val jobs = build(
            orders = listOf(
                order("OLD", "Pending", 10, listOf(piece("old"))),
                order("NEW", "Pending", 1, listOf(piece("new"))),
                order("DONE", "Completed", 0, listOf(piece("done"))),
            ),
        )
        assertEquals(listOf("order:NEW:0", "order:OLD:0", "order:DONE:0"), jobs.map { it.id })
    }

    @Test fun daysSinceIsWholeDaysAndNeverNegative() {
        assertEquals(0, WorkshopLogic.daysSince(null, now))
        assertEquals(0, WorkshopLogic.daysSince("junk", now))
        assertEquals(0, WorkshopLogic.daysSince(now.plusSeconds(86_400).toString(), now))
        assertEquals(2, WorkshopLogic.daysSince(now.minusSeconds(2 * 86_400 + 3_600).toString(), now))
        assertEquals(WorkshopJob.Urgency.warning, WorkshopLogic.urgency(WorkshopJob.Status.pending, 7))
        assertEquals(WorkshopJob.Urgency.critical, WorkshopLogic.urgency(WorkshopJob.Status.inProgress, 14))
        assertEquals(WorkshopJob.Urgency.ok, WorkshopLogic.urgency(WorkshopJob.Status.completed, 99))
    }

    // MARK: Filtering and focus

    private val sample: List<WorkshopJob> by lazy {
        build(
            orders = listOf(
                order("O1", "In Progress", 15, listOf(piece("Heavy kara", "K1", mapOf("givenAt" to days(14)))), mapOf("takenBy" to "Ammar")),
                order("O2", "Pending", 8, listOf(piece("Locket", "K1"), piece("Studs")), mapOf("takenBy" to "Mina")),
                order("O3", "Pending", 1, listOf(piece("Ring", "K2", mapOf("givenAt" to days(1))))),
                order("O4", "Completed", 4, listOf(piece("Done band", "K2"))),
            ),
            jobs = listOf(stock("J1", "K2", ago = 2)),
        )
    }

    @Test fun theBenchNarrowsByStatusTakenByTypeAndSearch() {
        assertEquals(5, WorkshopLogic.bench(sample, WorkshopFilter()).size) // active only hides the done one
        assertEquals(6, WorkshopLogic.bench(sample, WorkshopFilter(status = WorkshopStatusFilter.all)).size)
        assertEquals(1, WorkshopLogic.bench(sample, WorkshopFilter(status = WorkshopStatusFilter.completed)).size)
        assertEquals(2, WorkshopLogic.bench(sample, WorkshopFilter(takenBy = "Mina")).size)
        assertEquals(1, WorkshopLogic.bench(sample, WorkshopFilter(type = WorkshopTypeFilter.stock)).size)
        assertEquals(4, WorkshopLogic.bench(sample, WorkshopFilter(type = WorkshopTypeFilter.order)).size)
        assertEquals(listOf("order:O1:0"), WorkshopLogic.bench(sample, WorkshopFilter(query = "  KARA ")).map { it.id })
        assertEquals(2, WorkshopLogic.bench(sample, WorkshopFilter(query = "o2")).size) // an order number
        assertEquals(1, WorkshopLogic.bench(sample, WorkshopFilter(query = "Stacked")).size) // a stock job
        assertTrue(WorkshopFilter(status = WorkshopStatusFilter.all).narrowed)
        assertFalse(WorkshopFilter(karigarId = "K1").narrowed)
        assertEquals(2, WorkshopFilter(karigarId = "K1", takenBy = "x").menuCount)
    }

    @Test fun theSnapshotKeepsTheWholeBenchBesideOneKarigar() {
        val snap = WorkshopSnapshot(sample, WorkshopFilter(karigarId = "K1"))
        assertEquals(5, snap.bench.size)
        assertEquals(2, snap.filtered.size)
        // Work with nobody on it ignores the karigar filter.
        assertEquals(1, snap.unassignedJobs.size)
        assertEquals(1, snap.count(WorkshopFocus.unassigned))
        // Late or unassigned, among his: the 15-day kara and the 8-day locket.
        assertEquals(2, snap.count(WorkshopFocus.attention))
        // Assigned and not yet given: the locket.
        assertEquals(listOf("order:O2:0"), snap.notGiven.map { it.id })
        assertEquals(2, snap.count(WorkshopFocus.all))
        assertEquals(5, snap.stats.active)
        assertEquals(1, snap.stats.critical)
        assertEquals(2, snap.stats.workers) // K1, K2
        assertEquals(1, snap.stats.unassigned)
    }

    @Test fun karigarsAreGroupedUnassignedFirstThenMostAtRisk() {
        val loads = WorkshopLogic.groupByKarigar(sample.filter { !it.isDone })
        assertEquals(listOf(WorkshopLogic.unassigned, "K1", "K2"), loads.map { it.karigarId })
        val k1 = loads[1]
        assertEquals(2, k1.active)
        assertEquals(2, k1.overdue)
        assertEquals(1, k1.critical)
        assertEquals(1, k1.late)
        assertEquals(15, k1.oldestActiveDays)
        assertEquals(9.0, k1.totalWeightG)
        assertEquals(100000.0, k1.totalValue)
        assertEquals("Ustad Demo", k1.karigarName)
    }

    @Test fun anOrdersPiecesSitTogetherOldestGroupFirst() {
        val groups = WorkshopLogic.groupJobsByOrder(sample.filter { !it.isDone })
        assertEquals("order:O1", groups.first().key)
        val o2 = groups.first { it.key == "order:O2" }
        assertEquals(2, o2.jobs.size)
        assertTrue(groups.any { it.key == "job:job:J1" }) // a stock piece stands alone
        assertEquals(groups.flatMap { it.jobs }, WorkshopLogic.byOrder(sample.filter { !it.isDone }))
    }

    // MARK: Words

    @Test fun numbersAndGramsAreSaidTheKarigarsWay() {
        assertEquals("3.5", WorkshopLogic.number(3.5))
        assertEquals("12", WorkshopLogic.number(12.0))
        assertEquals("0.125", WorkshopLogic.number(0.125))
        assertEquals("1.1", WorkshopLogic.number(1.0504, 1))
        assertEquals("0", WorkshopLogic.number(0.0))
        assertEquals("3.500g", WorkshopLogic.grams3(3.5))
        assertEquals("3.5g", WorkshopLogic.grams(3.5))
        assertEquals("1 piece", WorkshopLogic.pieces(1))
        assertEquals("5 pieces", WorkshopLogic.pieces(5))
        assertEquals("+923001234567", WorkshopLogic.dialable("+92 300-1234567"))
        assertEquals(3.0, WorkshopLogic.roundedAway(2.5))
        assertEquals(-3.0, WorkshopLogic.roundedAway(-2.5))
    }

    @Test fun theShareListIsWhatsAppFriendlyOldestFirst() {
        val load = WorkshopLogic.groupByKarigar(sample).first { it.karigarId == "K1" }
        val text = WorkshopLogic.shareText(load, "TAHERI")
        val lines = text.split("\n")
        assertEquals("*TAHERI — Work List*", lines[0])
        assertEquals("*Ustad Demo*", lines[1])
        assertEquals("2 pending items", lines[2])
        assertEquals("", lines[3])
        assertTrue(lines[4].startsWith("1. Heavy kara 🔴"))
        assertEquals("   4.5g · 21K", lines[5])
        assertEquals("   Order O1 (Demo Customer)", lines[6])
        assertEquals("   15 days since given", lines[7])
        assertTrue(lines[8].startsWith("2. Locket ⚠️"))
        val empty = WorkshopLogic.shareText(WorkshopLoad("K9", emptyList()), "TAHERI")
        assertTrue(empty.endsWith("0 pending items\n\nNo pending work. ✅"))
    }

    // MARK: Paths

    @Test fun karigarPathsAndQueries() {
        assertEquals("/karigars/KAR-1", WorkshopLogic.karigarPath("KAR-1"))
        assertEquals("/karigars/Ustad%20Demo", WorkshopLogic.karigarPath("Ustad Demo"))
        assertEquals("KAR-1", WorkshopLogic.karigarId("/karigars/KAR-1"))
        assertEquals("Ustad Demo", WorkshopLogic.karigarId("/karigars/Ustad%20Demo?x=1"))
        assertNull(WorkshopLogic.karigarId("/karigars"))
        assertNull(WorkshopLogic.karigarId("/karigars/add"))
        assertNull(WorkshopLogic.karigarId("/karigars/KAR-1/edit"))
        assertNull(WorkshopLogic.karigarId("/karigars/KAR-1?web=1"))
        assertEquals("KAR-1", WorkshopLogic.karigarEditId("/karigars/KAR-1/edit"))
        assertNull(WorkshopLogic.karigarEditId("/karigars/edit"))
        assertNull(WorkshopLogic.karigarEditId("/karigars/KAR-1/edit?web=1"))
        assertTrue(WorkshopLogic.isPage("/workshop?karigar=K1", "/workshop"))
        assertFalse(WorkshopLogic.isPage("/workshop?web=1", "/workshop"))
        assertEquals("K1", WorkshopLogic.queryValue("karigar", "/workshop?order=O&karigar=K1"))
        assertEquals("ORD 1", WorkshopLogic.queryValue("order", "/workshop?order=ORD%201"))
        assertNull(WorkshopLogic.queryValue("karigar", "/workshop"))
    }

    @Test fun theRoutesPickTheRightScreen() {
        fun first(path: String) = WorkshopRoutes.indexOfFirst { it.matches(path) }
        assertEquals(0, first("/workshop"))
        assertEquals(0, first("/workshop?karigar=K1"))
        assertEquals(-1, first("/workshop?web=1"))
        assertEquals(1, first("/karigars"))
        assertEquals(2, first("/karigars/add"))
        assertEquals(3, first("/karigars/K1/edit"))
        assertEquals(4, first("/karigars/K1"))
        assertEquals(5, first("/given"))
        assertEquals(-1, first("/karigars/K1?web=1"))
    }

    // MARK: His position (karigar-position.ts)

    @Test fun hisPositionKeepsTwoMeasuresOfMetalApart() {
        val gold = HisaabEntry(
            "H1", "K1", erp.core.models.HisaabEntityType.karigar, "Ustad Demo", days(3), "Gold out", 0.0, 0.0, 12.5, 0.0, null,
        )
        val back = gold.copy(id = "H2", description = "Back", goldDebitGrams = 0.0, goldCreditGrams = 3.0)
        val cash = gold.copy(id = "H3", goldDebitGrams = 0.0, cashDebit = 1000.0, cashCredit = 4000.0)
        val other = gold.copy(id = "H4", entityId = "K2", goldDebitGrams = 99.0)
        val out = ERPDecode.model<GivenItem>(mapOf("id" to "G1", "description" to "Old bangle", "recipientType" to "karigar", "recipientName" to "  ustad   DEMO ", "status" to "out"))!!
        val linked = ERPDecode.model<GivenItem>(mapOf("id" to "G2", "description" to "Sample", "recipientType" to "karigar", "recipientName" to "Someone", "recipientId" to "K1", "status" to "out"))!!
        val elsewhere = ERPDecode.model<GivenItem>(mapOf("id" to "G3", "description" to "Other", "recipientType" to "karigar", "recipientName" to "Ustad Demo", "recipientId" to "K2", "status" to "out"))!!
        val back2 = ERPDecode.model<GivenItem>(mapOf("id" to "G4", "description" to "Back", "recipientType" to "karigar", "recipientName" to "Ustad Demo", "status" to "returned"))!!
        val p = WorkshopPosition("K1", "Ustad Demo", sample, listOf(out, linked, elsewhere, back2), listOf(gold, back, cash, other))
        assertEquals(listOf("order:O1:0", "order:O2:0"), p.bench.map { it.id }) // oldest first, his, not done
        assertEquals(listOf("gold 21k"), p.metals.map { it.label })
        assertEquals(9.0, p.metals.single().grams)
        assertEquals(0, p.unweighed)
        assertEquals(12.5, p.khataGiven)
        assertEquals(3.0, p.khataBack)
        assertEquals(9.5, p.khataNet)
        assertEquals(-3000.0, p.cashBalance)
        assertEquals(listOf("G1", "G2"), p.given.map { it.id })
    }

    @Test fun unweighedPiecesAreCountedNotSummed() {
        val jobs = build(orders = listOf(order("O1", "Pending", 1, listOf(piece("A", "K1", mapOf("estimatedWeightG" to 0)), piece("B", "K1")))))
        val p = WorkshopPosition("K1", "Ustad Demo", jobs, emptyList(), emptyList())
        assertEquals(1, p.unweighed)
        assertEquals(1, p.metals.size)
    }

    // MARK: Pay batches

    @Test fun theNewestOpenBatchPerKarigarIsTheActiveOne() {
        fun batch(id: String, k: String, start: String, closed: String? = null) =
            ERPDecode.model<KarigarBatch>(mapOf("id" to id, "karigarId" to k, "label" to id, "startDate" to start) + (if (closed != null) mapOf("closedDate" to closed) else emptyMap()))!!
        val open = WorkshopLogic.openBatches(
            listOf(
                batch("A", "K1", "2026-09-01T00:00:00Z"), batch("B", "K1", "2026-10-01T00:00:00Z"),
                batch("C", "K1", "2026-08-01T00:00:00Z", closed = "2026-08-30T00:00:00Z"), batch("D", "K2", "2026-09-15T00:00:00Z"),
            ),
        )
        assertEquals("B", open["K1"]?.id)
        assertEquals("D", open["K2"]?.id)
    }

    // MARK: The karigars list

    @Test fun theBusiestAndMostOverdueComeFirst() {
        val loads = KarigarsLogic.loadsById(sample)
        val live = karigars + karigar("K3", "Zed Free")
        val (working, free) = KarigarsLogic.split(live, loads, "")
        assertEquals(listOf("K1", "K2"), working.map { it.id })
        assertEquals(listOf("K3"), free.map { it.id })
        assertEquals(listOf("K2"), KarigarsLogic.split(live, loads, "example").first.map { it.id })
        assertEquals(listOf("K1"), KarigarsLogic.split(live, loads, "0300").first.map { it.id }.take(1)) // contact
        assertNotNull(loads["K1"])
    }

    @Test fun removedKarigarsAreOffTheBooks() {
        val gone = ERPDecode.model<Karigar>(mapOf("id" to "K9", "name" to "Gone", "deletedAt" to days(1)))!!
        assertEquals(listOf("K1", "K2"), workshopLive(karigars + gone).map { it.id })
    }

    // MARK: Typed figures

    @Test fun aTypedFigureKeepsDigitsAndOneDot() {
        assertEquals(125000.0, WorkshopFigure.read("PKR 1,25,000", 2))
        assertEquals(1250.5, WorkshopFigure.read("1 250.50", 2))
        assertEquals(3.123, WorkshopFigure.read("3.12345"))
        assertEquals(2.0, WorkshopFigure.read("2.7", 0))
        assertNull(WorkshopFigure.read(""))
        assertNull(WorkshopFigure.read("."))
        assertEquals("", WorkshopFigure.field(0.0))
        assertEquals("", WorkshopFigure.field(null))
        assertEquals("3.5", WorkshopFigure.field(3.5))
    }
}
