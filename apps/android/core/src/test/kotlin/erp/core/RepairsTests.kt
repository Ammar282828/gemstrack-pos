package erp.core

import erp.core.logic.repairBalance
import erp.core.logic.repairPaid
import erp.core.logic.repairSummary
import erp.core.logic.repairTotal
import erp.core.models.Repair
import kotlin.test.Test
import kotlin.test.assertEquals

/** src/lib/repairs.ts (no TS test file: the cases are read off the functions). All names and amounts made up. */
class RepairsTests {
    private fun repair(json: String): Repair = Json.decode<Repair>(json)!!

    @Test
    fun totalPaidAndBalance() {
        val r = repair(
            """{"id":"REP-000001","customerName":"Sana Example","status":"received",
             "pieces":[{"item":"Gold ring","work":"resize","price":2500},{"item":"Chain","work":"re-solder","price":1000.5}],
             "payments":[{"amount":1000,"date":"2026-10-03T09:00:00Z"},{"amount":500.25,"date":"2026-10-04T09:00:00Z"}]}""",
        )
        assertEquals(3_500.5, repairTotal(r))
        assertEquals(1_500.25, repairPaid(r))
        assertEquals(2_000.25, repairBalance(r))
    }

    @Test
    fun aPieceWithNoPriceCountsAsNothingAndOverpaidOwesNothing() {
        val r = repair(
            """{"id":"REP-000002","customerName":"Bilal Sample","status":"ready",
             "pieces":[{"item":"Bangle","work":"polish"}],"payments":[{"amount":300,"date":"2026-10-04T00:00:00Z"}]}""",
        )
        assertEquals(0.0, repairTotal(r))
        assertEquals(0.0, repairBalance(r))
        assertEquals(0.0, repairBalance(repair("""{"id":"x","customerName":"n","status":"received"}""")))
    }

    @Test
    fun balanceIsRoundedToTheCent() {
        val r = repair(
            """{"id":"REP-000003","customerName":"Test","status":"received",
             "pieces":[{"item":"Ring","work":"a","price":0.3}],"payments":[{"amount":0.1,"date":"2026-10-04T00:00:00Z"}]}""",
        )
        assertEquals(0.2, repairBalance(r))
    }

    @Test
    fun summary() {
        val none = repair("""{"id":"a","customerName":"n","status":"received","pieces":[{"item":"","work":"x"}]}""")
        assertEquals("Repair", repairSummary(none))
        val one = repair("""{"id":"a","customerName":"n","status":"received","pieces":[{"item":"Gold ring","work":"x"}]}""")
        assertEquals("Gold ring", repairSummary(one))
        val three = repair("""{"id":"a","customerName":"n","status":"received","pieces":[{"item":"Gold ring","work":"x"},{"item":""},{"item":"Chain"},{"item":"Bangle"}]}""")
        assertEquals("Gold ring + 2 more", repairSummary(three))
    }
}
