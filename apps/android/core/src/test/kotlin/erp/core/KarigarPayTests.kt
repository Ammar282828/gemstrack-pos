package erp.core

import erp.core.logic.KarigarPay
import erp.core.models.Expense
import erp.core.models.KarigarBatch
import erp.core.models.KarigarSilverTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** src/lib/karigar-pay.test.ts, case for case. Karigars, batches and amounts made up. */
class KarigarPayTests {
    private fun pay(id: String, date: String, amount: Any, more: Map<String, Any?> = emptyMap()): Expense {
        val f = mutableMapOf<String, Any?>("id" to id, "date" to date, "amount" to amount, "karigarId" to "k1")
        f.putAll(more)
        return ERPDecode.model<Expense>(f)!!
    }

    private fun batch(id: String, startDate: String, more: Map<String, Any?> = emptyMap()): KarigarBatch {
        val f = mutableMapOf<String, Any?>("id" to id, "karigarId" to "k1", "label" to id.uppercase(), "startDate" to startDate)
        f.putAll(more)
        return ERPDecode.model<KarigarBatch>(f)!!
    }

    private fun silverRow(f: Map<String, Any?>): KarigarSilverTransaction = ERPDecode.model<KarigarSilverTransaction>(f)!!

    private val batches: List<KarigarBatch>
        get() = listOf(
            batch("b-aug", "2026-08-01T09:00:00.000Z", mapOf("closedDate" to "2026-08-31T18:00:00.000Z")),
            batch("b-sep", "2026-09-01T09:00:00.000Z", mapOf("closedDate" to "2026-09-30T18:00:00.000Z")),
            batch("b-oct", "2026-10-01T09:00:00.000Z"),
            batch("b-other", "2026-10-02T09:00:00.000Z", mapOf("karigarId" to "k2")),
        )

    private val expenses: List<Expense>
        get() = listOf(
            pay("e1", "2026-08-10T10:00:00.000Z", 5_000, mapOf("batchId" to "b-aug")),
            pay("e2", "2026-09-12T10:00:00.000Z", 7_000, mapOf("batchId" to "b-sep")),
            pay("e3", "2026-09-20T10:00:00.000Z", 3_000, mapOf("batchId" to "b-sep")),
            pay("e4", "2026-10-03T10:00:00.000Z", 4_000, mapOf("batchId" to "b-oct")),
            pay("e5", "2026-10-05T10:00:00.000Z", 6_000, mapOf("batchId" to "b-oct")),
            pay("e6", "2026-07-01T10:00:00.000Z", 1_500),
            pay("e7", "2026-10-04T10:00:00.000Z", 900, mapOf("karigarId" to "k2", "batchId" to "b-other")),
            pay("e8", "2026-10-06T10:00:00.000Z", 250, mapOf("karigarId" to null)),
        )

    // MARK: karigarPay

    @Test
    fun testAddsEveryPaymentToHimInTheBatchesAndOutsideThemAndNobodyElses() {
        assertEquals(26_500.0, KarigarPay.figures(karigarId = "k1", expenses = expenses, batches = batches).totalPaid)
    }

    @Test
    fun testFilesHisPaymentsUnderTheOpenBatchNewestFirst() {
        val p = KarigarPay.figures(karigarId = "k1", expenses = expenses, batches = batches)
        assertEquals("b-oct", p.open?.batch?.id)
        assertEquals(listOf("e5", "e4"), p.open?.payments?.map { it.id })
        assertEquals(10_000.0, p.open?.total)
    }

    @Test
    fun testListsTheSettledBatchesNewestFirstEachTotalledFromItsPaymentsAsTheyAreNow() {
        val p = KarigarPay.figures(
            karigarId = "k1", expenses = expenses,
            batches = batches + listOf(batch("b-jul", "2026-07-01T09:00:00.000Z", mapOf("closedDate" to "2026-07-31T18:00:00.000Z"))),
        )
        assertEquals(listOf("b-sep", "b-aug", "b-jul"), p.settled.map { it.batch.id })
        assertEquals(listOf(10_000.0, 5_000.0, 0.0), p.settled.map { it.total })
        assertEquals(listOf(listOf("e3", "e2"), listOf("e1"), emptyList()), p.settled.map { s -> s.payments.map { it.id } })
    }

    @Test
    fun testKeepsPaymentsOutsideAnyBatchApartABlankBatchIdCountingAsNone() {
        val p = KarigarPay.figures(
            karigarId = "k1",
            expenses = expenses + listOf(pay("e9", "2026-10-07T10:00:00.000Z", 100, mapOf("batchId" to "")), pay("e10", "2026-06-01T10:00:00.000Z", 50, mapOf("batchId" to null))),
            batches = batches,
        )
        assertEquals(listOf("e9", "e6", "e10"), p.direct.map { it.id })
        assertEquals(1_650.0, p.directTotal)
    }

    @Test
    fun testListsAPaymentWhoseBatchWasDeletedWithTheDirectOnesAndCountsItInWhatHeHasBeenPaid() {
        val p = KarigarPay.figures(
            karigarId = "k1",
            expenses = listOf(pay("e1", "2026-10-01T10:00:00.000Z", 2_000, mapOf("batchId" to "gone")), pay("e2", "2026-10-02T10:00:00.000Z", 500)),
            batches = emptyList(),
        )
        assertEquals(2_500.0, p.totalPaid)
        assertNull(p.open)
        assertTrue(p.settled.isEmpty())
        assertEquals(listOf("e2", "e1"), p.direct.map { it.id })
        assertEquals(2_500.0, p.directTotal)
    }

    @Test
    fun testTakesTheNewestOpenBatchWhenTwoAreOpenAndABlankClosingDateAsOpen() {
        val two = listOf(batch("old", "2026-09-01T09:00:00.000Z"), batch("new", "2026-10-01T09:00:00.000Z", mapOf("closedDate" to "")))
        assertEquals("new", KarigarPay.figures(karigarId = "k1", expenses = emptyList(), batches = two).open?.batch?.id)
        assertTrue(KarigarPay.isOpen(batch("a", "2026-10-01T00:00:00.000Z", mapOf("closedDate" to ""))))
        assertTrue(KarigarPay.isOpen(batch("b", "2026-10-01T00:00:00.000Z", mapOf("closedDate" to null))))
        assertTrue(KarigarPay.isOpen(batch("c", "2026-10-01T00:00:00.000Z")))
        assertFalse(KarigarPay.isOpen(batch("d", "2026-10-01T00:00:00.000Z", mapOf("closedDate" to "2026-10-01T00:00:00.000Z"))))
    }

    @Test
    fun testSortsADateItCannotReadAsTheOldestAndKeepsEqualDatesInTheOrderTheyCame() {
        val p = KarigarPay.figures(
            karigarId = "k1",
            expenses = listOf(pay("odd", "someday", 10), pay("a", "2026-10-01T10:00:00.000Z", 20), pay("b", "2026-10-01T10:00:00.000Z", 30)),
            batches = listOf(
                batch("x", "soon", mapOf("closedDate" to "2026-10-01T00:00:00.000Z")),
                batch("y", "2026-09-01T09:00:00.000Z", mapOf("closedDate" to "2026-09-30T00:00:00.000Z")),
            ),
        )
        assertEquals(listOf("a", "b", "odd"), p.direct.map { it.id })
        assertEquals(listOf("y", "x"), p.settled.map { it.batch.id })
    }

    @Test
    fun testReadsAnAmountKeptAsTextAndOneThatIsNotANumberAsNothing() {
        val odd = listOf(pay("t", "2026-10-01T10:00:00.000Z", "1500"), pay("n", "2026-10-02T10:00:00.000Z", "lots"))
        assertEquals(1_500.0, KarigarPay.figures(karigarId = "k1", expenses = odd, batches = emptyList()).totalPaid)
    }

    // MARK: batchTotal

    @Test
    fun testBatchTotalIsWhatSettlingWritesHisPaymentsFiledUnderTheBatch() {
        val b = batch("b-oct", "2026-10-01T09:00:00.000Z")
        val filed = listOf(
            pay("e1", "2026-10-02T10:00:00.000Z", 4_000, mapOf("batchId" to "b-oct")),
            pay("e2", "2026-10-03T10:00:00.000Z", 2_500, mapOf("batchId" to "b-oct")),
            // Someone else's expense with the same batch id is not his.
            pay("e3", "2026-10-03T10:00:00.000Z", 9_999, mapOf("batchId" to "b-oct", "karigarId" to "k2")),
            pay("e4", "2026-10-04T10:00:00.000Z", 1_000),
        )
        assertEquals(6_500.0, KarigarPay.batchTotal(b, expenses = filed))
        assertEquals(listOf("e2", "e1"), KarigarPay.batchPayments(b, expenses = filed).map { it.id })
        assertEquals(0.0, KarigarPay.batchTotal(b, expenses = emptyList()))
    }

    // MARK: Silver

    @Test
    fun testChargesTheGramsAtTheRatePerGram() {
        assertEquals(437.5, KarigarPay.silverSurcharge(grams = 12.5, perGram = 35.0))
        assertEquals(0.0, KarigarPay.silverSurcharge(grams = 50.0, perGram = 0.0))
    }

    @Test
    fun testSaysWhatTheFormSaysWhenTheFiguresCannotBeSaved() {
        assertEquals("Silver grams must be greater than 0", KarigarPay.silverProblem(grams = 0.0, perGram = 10.0))
        assertEquals("Silver grams must be greater than 0", KarigarPay.silverProblem(grams = -1.0, perGram = 10.0))
        assertEquals("Silver grams must be greater than 0", KarigarPay.silverProblem(grams = Double.NaN, perGram = 10.0))
        assertEquals("Surcharge must be non-negative", KarigarPay.silverProblem(grams = 5.0, perGram = -1.0))
        assertEquals("Surcharge must be non-negative", KarigarPay.silverProblem(grams = 5.0, perGram = Double.POSITIVE_INFINITY))
        assertNull(KarigarPay.silverProblem(grams = 5.0, perGram = 0.0))
        assertNull(KarigarPay.silverProblem(grams = 0.001, perGram = 35.0))
    }

    @Test
    fun testAddsHisSilverEntriesNewestFirstAndNobodyElses() {
        val rows = listOf(
            silverRow(mapOf("id" to "s1", "karigarId" to "k1", "date" to "2026-09-01T10:00:00.000Z", "silverGrams" to 50.5, "surchargePerGram" to 30, "totalSurcharge" to 1_515)),
            silverRow(mapOf("id" to "s2", "karigarId" to "k1", "date" to "2026-10-01T10:00:00.000Z", "silverGrams" to 20, "surchargePerGram" to 35, "totalSurcharge" to 700)),
            silverRow(mapOf("id" to "s3", "karigarId" to "k2", "date" to "2026-10-02T10:00:00.000Z", "silverGrams" to 99, "surchargePerGram" to 1, "totalSurcharge" to 99)),
        )
        val s = KarigarPay.silver(karigarId = "k1", rows = rows)
        assertEquals(listOf("s2", "s1"), s.rows.map { it.id })
        assertEquals(70.5, s.grams, 1e-9)
        assertEquals(2_215.0, s.surcharge)
        val none = KarigarPay.silver(karigarId = "nobody", rows = rows)
        assertTrue(none.rows.isEmpty())
        assertEquals(0.0, none.grams)
        assertEquals(0.0, none.surcharge)
    }

    @Test
    fun testDecodesASilverEntryLeniently() {
        val s = silverRow(mapOf("id" to "s1", "karigarId" to "k1", "silverGrams" to "12.5", "totalSurcharge" to "437.5"))
        assertEquals(12.5, s.silverGrams)
        assertEquals(0.0, s.surchargePerGram)
        assertEquals(437.5, s.totalSurcharge)
        assertEquals("", s.date)
        assertNull(s.description)
    }
}
