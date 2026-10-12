package erp.core

import erp.core.logic.KarigarPortal
import erp.core.logic.KarigarPortalGroup
import erp.core.logic.KarigarPortalJob
import erp.core.logic.KarigarPortalPerson
import erp.core.logic.KarigarPortalRules
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The karigar portal (src/app/my-work/page.tsx, /api/karigar/me, groupJobsByOrder in workshop.ts). The JSON is the
 * route's own shape, made-up names.
 */
class KarigarPortalTests {
    private fun job(
        id: String,
        source: String = "order",
        orderId: String? = null,
        status: String = "pending",
        age: Int = 1,
        urgency: String = "ok",
        more: Map<String, Any?> = emptyMap(),
    ): KarigarPortalJob {
        val f = mutableMapOf<String, Any?>(
            "id" to id, "source" to source, "description" to "Piece $id", "status" to status,
            "assignedDate" to "2026-10-01T08:00:00Z", "ageDays" to age, "urgency" to urgency,
        )
        if (orderId != null) f["orderId"] = orderId
        f.putAll(more)
        return ERPDecode.model<KarigarPortalJob>(f)!!
    }

    @Test
    fun testTheRoutesAnswerReads() {
        val json = """
        {"role":"karigar","preview":false,"karigar":{"id":"KAR-1","name":"Ustad Demo"},
         "summary":{"active":3,"inProgress":1,"late":1,"critical":1,"oldestDays":15},
         "jobs":[{"id":"order:ORD-7:0","source":"order","description":"Plain band","weightG":4.2,"quantity":1,"size":"12",
                  "status":"in-progress","assignedDate":"2026-09-24T08:00:00.000Z","ageDays":15,"urgency":"critical","orderId":"ORD-7",
                  "sampleGiven":true,"notes":"Matte finish"}],
         "account":{"goldGiven":10.5,"goldReceived":4,"goldNet":6.5,"totalPaid":120000,
                    "ledger":[{"date":"2026-10-02T00:00:00.000Z","description":"Gold given","goldOut":10.5,"goldIn":0}],
                    "payments":[{"date":"2026-10-03T00:00:00.000Z","amount":120000,"description":"Part payment"}]}}
        """
        val p = assertNotNull(Json.decode<KarigarPortal>(json))
        assertEquals("karigar", p.role)
        assertFalse(p.preview)
        assertEquals(KarigarPortalPerson("KAR-1", "Ustad Demo"), p.karigar)
        assertEquals(3, p.summary.active)
        assertEquals(1, p.summary.critical)
        assertEquals(1, p.jobs.size)
        assertEquals(4.2, p.jobs[0].weightG)
        assertTrue(p.jobs[0].sampleGiven)
        assertEquals("Matte finish", p.jobs[0].notes)
        assertEquals(6.5, p.account.goldNet)
        assertEquals(1, p.account.ledger.size)
        assertEquals(120000.0, p.account.payments[0].amount)
    }

    @Test
    fun testNoWorkAccountReadsAsNoKarigar() {
        // What the route says to an owner who named nobody, or to an address with no karigar on file.
        val p = assertNotNull(Json.decode<KarigarPortal>("""{"role":"owner","karigar":null}"""))
        assertNull(p.karigar)
        assertEquals(0, p.jobs.size)
        assertEquals(0, p.summary.active)
        assertEquals(0.0, p.account.totalPaid)
        val none = assertNotNull(Json.decode<KarigarPortal>("{}"))
        assertNull(none.karigar)
    }

    @Test
    fun testTheSectionsSplitByUrgencyOldestFirstWithinAnOrderAndTheFinishedApart() {
        val jobs = listOf(
            job("a", orderId = "ORD-2", age = 3, urgency = "ok"),
            job("b", orderId = "ORD-1", age = 16, urgency = "critical"),
            job("c", orderId = "ORD-1", age = 9, urgency = "warning"),
            job("d", orderId = "ORD-3", status = "completed", age = 20),
            job("e", source = "manual", age = 15, urgency = "critical"),
            job("f", orderId = "ORD-1", age = 1, urgency = "ok"),
        )
        val s = KarigarPortalRules.sections(jobs)
        assertEquals(5, s.active.size)
        // By order number (a stock piece last), then the oldest first.
        assertEquals(listOf("b", "e"), s.critical.map { it.id })
        assertEquals(listOf("c"), s.late.map { it.id })
        assertEquals(listOf("f", "a"), s.onTrack.map { it.id })
        assertEquals(listOf("d"), s.done.map { it.id })
    }

    @Test
    fun testPiecesGroupUnderTheirOrderTheOldestGroupFirst() {
        val jobs = listOf(
            job("a", orderId = "ORD-2", age = 3),
            job("b", orderId = "ORD-1", age = 5),
            job("c", orderId = "ORD-2", age = 9),
            job("d", source = "manual", age = 7),
            job("e", source = "manual", age = 7),
        )
        val g = KarigarPortalRules.groups(jobs)
        // ORD-2 is 9 days old (its oldest piece), then the two stock pieces (7, each alone), then ORD-1 (5).
        assertEquals(listOf("order:ORD-2", "job:d", "job:e", "order:ORD-1"), g.map { it.key })
        assertEquals(listOf("a", "c"), g[0].jobs.map { it.id })
        assertEquals(9, g[0].ageDays)
        assertEquals("ORD-2", g[0].orderId)
        assertFalse(g[0].isStock)
        assertTrue(g[1].isStock)
        assertNull(g[1].orderId)
    }

    @Test
    fun testACardIsUrgentByItsOldestPieceUnlessAllAreDone() {
        fun group(jobs: List<KarigarPortalJob>): KarigarPortalGroup = KarigarPortalRules.groups(jobs)[0]
        assertEquals("critical", group(listOf(job("a", orderId = "O", age = 14))).urgency)
        assertEquals("warning", group(listOf(job("a", orderId = "O", age = 7))).urgency)
        assertEquals("ok", group(listOf(job("a", orderId = "O", age = 6))).urgency)
        assertEquals("ok", group(listOf(job("a", orderId = "O", status = "completed", age = 30))).urgency)
        // The card's age is its oldest piece's, finished or not (groupJobsByOrder takes the max of all).
        assertEquals("warning", group(listOf(job("a", orderId = "O", status = "completed", age = 2), job("b", orderId = "O", age = 8))).urgency)
    }

    @Test
    fun testTheSpecBoxesInThePagesOrder() {
        val j = job(
            "a", orderId = "O",
            more = mapOf("size" to "12", "weightG" to 4.5, "plating" to "White Rhodium", "category" to "Rings", "karat" to "21k", "referenceSku" to "R-12", "quantity" to 2),
        )
        val specs = KarigarPortalRules.specs(j)
        assertEquals(listOf("Size", "Weight", "Finish", "Type", "Karat", "Ref", "Qty"), specs.map { it.label })
        assertEquals(listOf("12", "4.5g", "White Rhodium", "Rings", "21K", "R-12", "2"), specs.map { it.value })
        assertEquals(listOf(true, false, true, false, false, false, false), specs.map { it.accent })
        // Nothing to say, no boxes; one of a thing is not a quantity; a zero weight is no weight.
        assertEquals(0, KarigarPortalRules.specs(job("b", orderId = "O", more = mapOf("weightG" to 0, "quantity" to 1))).size)
    }

    @Test
    fun testDatesAreKarachisAndGramsHaveThreePlaces() {
        assertEquals("05 Oct 2026", KarigarPortalRules.date("2026-10-05T08:00:00.000Z"))
        assertEquals("05 Oct 26", KarigarPortalRules.date("2026-10-05T08:00:00.000Z", shortYear = true))
        // 4 Oct 20:00 UTC is already the 5th in Karachi.
        assertEquals("05 Oct 2026", KarigarPortalRules.date("2026-10-04T20:00:00Z"))
        assertEquals("30 Sep 2026", KarigarPortalRules.date("2026-09-30T08:00:00Z"))
        assertEquals("", KarigarPortalRules.date(""))
        assertEquals("6.500g", KarigarPortalRules.grams(6.5))
        assertEquals("0.000g", KarigarPortalRules.grams(0.0))
    }
}
