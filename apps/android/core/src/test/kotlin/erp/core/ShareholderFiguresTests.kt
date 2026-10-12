package erp.core

import erp.core.logic.PartnerBalance
import erp.core.logic.ShareholderFigures
import erp.core.models.AdditionalRevenue
import erp.core.models.Expense
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.PartnerLedgerCategory
import erp.core.models.PartnerLedgerType
import erp.core.models.ShareholderLedgerRow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** src/lib/shareholder-figures.test.ts, case for case. All names and amounts made up. */
class ShareholderFiguresTests {
    private val partners: List<Pair<String, String>> = listOf("mina" to "Mina", "ammar" to "Ammar")

    private fun expense(f: Map<String, Any?>): Expense = ERPDecode.model<Expense>(f)!!
    private fun invoice(f: Map<String, Any?>): Invoice = ERPDecode.model<Invoice>(f)!!
    private fun order(f: Map<String, Any?>): Order = ERPDecode.model<Order>(f)!!
    private fun revenue(f: Map<String, Any?>): AdditionalRevenue = ERPDecode.model<AdditionalRevenue>(f)!!

    private fun row(id: String, type: PartnerLedgerType, category: PartnerLedgerCategory, amount: Double) =
        ShareholderLedgerRow(id = id, description = "Entry $id", amount = amount, date = "2026-09-15T12:00:00.000Z", category = category, type = type)

    private fun totals(expShare: Double, revShare: Double) =
        ShareholderFigures.Totals(totalExpenses = expShare * 2, totalRevenue = revShare * 2, drawings = 0.0, expShare = expShare, revShare = revShare)

    // MARK: The partnership's profit and loss

    @Test
    fun testCountsFromTheCutoffsLeavesDrawingsOutOfTheCostsAndCountsThemApart() {
        val expenses = listOf(
            expense(mapOf("id" to "e1", "date" to "2025-07-01T10:00:00.000Z", "amount" to 9_999, "category" to "Rent", "description" to "Before the partnership")),
            expense(mapOf("id" to "e2", "date" to "2025-07-02T10:00:00.000Z", "amount" to 20_000, "category" to "Rent", "description" to "Rent")),
            expense(mapOf("id" to "e3", "date" to "2026-01-10T10:00:00.000Z", "amount" to 6_000, "category" to "Partner Salary", "shareholderId" to "mina", "description" to "Mina salary — January")),
            expense(mapOf("id" to "e4", "date" to "2026-02-10T10:00:00.000Z", "amount" to 15_000, "category" to "Partner Drawings", "description" to "Ammar — capital returned")),
            expense(mapOf("id" to "e5", "date" to "", "amount" to 1_000, "category" to "Rent", "description" to "No date")),
        )
        val orders = listOf(
            order(mapOf("id" to "ORD-1", "createdAt" to "2025-07-10T10:00:00.000Z", "subtotal" to 50_000, "invoiceId" to "INV-1")),
            order(mapOf("id" to "ORD-2", "createdAt" to "2025-08-01T10:00:00.000Z", "subtotal" to 30_000, "status" to "Pending")),
            order(mapOf("id" to "ORD-3", "createdAt" to "2025-08-02T10:00:00.000Z", "subtotal" to 8_000, "status" to "Cancelled")),
            order(mapOf("id" to "ORD-4", "createdAt" to "2025-08-03T10:00:00.000Z", "subtotal" to 9_000, "status" to "Refunded")),
            order(mapOf("id" to "ORD-5", "createdAt" to "2025-08-04T10:00:00.000Z", "subtotal" to 7_000)),
            order(mapOf("id" to "ORD-6", "createdAt" to "2025-07-15T10:00:00.000Z", "subtotal" to 4_000)),
        )
        val invoices = listOf(
            // Billed after the cutoff for an order taken before it: left out, as the page leaves it.
            invoice(mapOf("id" to "INV-1", "createdAt" to "2025-08-01T10:00:00.000Z", "sourceOrderId" to "ORD-1", "grandTotal" to 50_000)),
            invoice(mapOf("id" to "INV-2", "createdAt" to "2025-09-01T10:00:00.000Z", "grandTotal" to 40_000, "exchanges" to listOf(mapOf("description" to "Old chain", "value" to 10_000)))),
            invoice(mapOf("id" to "INV-3", "createdAt" to "2025-09-02T10:00:00.000Z", "grandTotal" to 70_000, "status" to "Refunded")),
            // ORD-5's invoice: the order is billed, so only the invoice counts.
            invoice(mapOf("id" to "INV-4", "createdAt" to "2025-09-03T10:00:00.000Z", "sourceOrderId" to "ORD-5", "grandTotal" to 7_000)),
        )
        val extra = listOf(
            revenue(mapOf("id" to "r1", "date" to "2025-07-15T10:00:00.000Z", "amount" to 500)),
            revenue(mapOf("id" to "r2", "date" to "2025-07-16T00:00:00.000Z", "amount" to 2_500)),
        )
        val t = ShareholderFigures.partnershipTotals(expenses = expenses, invoices = invoices, orders = orders, additionalRevenues = extra)
        assertEquals(26_000.0, t.totalExpenses)
        assertEquals(15_000.0, t.drawings)
        // INV-2 with its exchange, INV-4, ORD-2 unbilled, the extra revenue from the 16th.
        assertEquals(50_000.0 + 7_000 + 30_000 + 2_500, t.totalRevenue)
        assertEquals(13_000.0, t.expShare)
        assertEquals(44_750.0, t.revShare)
    }

    @Test
    fun testStartsOnTheCutoffDaysThemselves() {
        assertEquals("2025-07-02", ShareholderFigures.expenseCutoff)
        assertEquals("2025-07-16", ShareholderFigures.revenueCutoff)
    }

    // MARK: Salaries

    @Test
    fun testAreThePartnerSalaryExpensesThatNameAPartnerNewestFirst() {
        val s = ShareholderFigures.salariesByPartner(
            listOf(
                expense(mapOf("id" to "s1", "date" to "2026-01-10T10:00:00.000Z", "amount" to 6_000, "category" to "Partner Salary", "shareholderId" to "mina", "description" to "a")),
                expense(mapOf("id" to "s2", "date" to "2026-03-10T10:00:00.000Z", "amount" to 6_000, "category" to "Partner Salary", "shareholderId" to "mina", "description" to "b")),
                expense(mapOf("id" to "s3", "date" to "2026-02-10T10:00:00.000Z", "amount" to 4_000, "category" to "Partner Salary", "shareholderId" to "ammar", "description" to "c")),
                expense(mapOf("id" to "s4", "date" to "2026-02-11T10:00:00.000Z", "amount" to 4_000, "category" to "Partner Salary", "description" to "nobody named")),
                expense(mapOf("id" to "s5", "date" to "2026-02-12T10:00:00.000Z", "amount" to 4_000, "category" to "Rent", "shareholderId" to "mina", "description" to "not a salary")),
            ),
        )
        assertEquals(listOf("s2", "s1"), s["mina"]?.map { it.id })
        assertEquals(listOf("s3"), s["ammar"]?.map { it.id })
    }

    @Test
    fun testAGapMovesHalfOfItFromOnePartnerToTheOtherUnderARupeeIsNone() {
        fun positions(a: Double, b: Double): List<ShareholderFigures.Position> {
            val salaries = mapOf(
                "mina" to (if (a > 0) listOf(expense(mapOf("id" to "m", "date" to "2026-01-01", "amount" to a, "category" to "Partner Salary", "shareholderId" to "mina"))) else emptyList()),
                "ammar" to (if (b > 0) listOf(expense(mapOf("id" to "a", "date" to "2026-01-01", "amount" to b, "category" to "Partner Salary", "shareholderId" to "ammar"))) else emptyList()),
            )
            return ShareholderFigures.partnerPositions(partners = partners, ledgers = emptyMap(), salariesBy = salaries, totals = totals(expShare = 0.0, revShare = 0.0))
        }
        val g = ShareholderFigures.salaryGap(positions(30_000.0, 10_000.0))
        assertEquals("Mina", g?.ahead?.name)
        assertEquals("Ammar", g?.behind?.name)
        assertEquals(10_000.0, g?.transferred)
        assertEquals("Ammar", ShareholderFigures.salaryGap(positions(0.0, 8_000.0))?.ahead?.name)
        assertNull(ShareholderFigures.salaryGap(positions(5_000.4, 5_000.0)))
        assertNull(ShareholderFigures.salaryGap(positions(5_000.0, 0.0).take(1)))
    }

    // MARK: Each partner's position

    @Test
    fun testIsTheirLedgerPlusTheirHalfOfThePAndL() {
        val ledgers = mapOf(
            "mina" to listOf(
                row("m1", PartnerLedgerType.payment, PartnerLedgerCategory.equity, 100_000.0),
                row("m2", PartnerLedgerType.payment, PartnerLedgerCategory.loan, 40_000.0),
                row("m3", PartnerLedgerType.withdrawal, PartnerLedgerCategory.equity, 10_000.0),
            ),
            "ammar" to listOf(
                row("a1", PartnerLedgerType.payment, PartnerLedgerCategory.equity, 60_000.0),
                row("a2", PartnerLedgerType.withdrawal, PartnerLedgerCategory.loan, 5_000.0),
            ),
        )
        val salaries = mapOf("mina" to listOf(expense(mapOf("id" to "s1", "date" to "2026-01-10", "amount" to 6_000, "description" to "x"))), "ammar" to emptyList<Expense>())
        val p = ShareholderFigures.partnerPositions(partners = partners, ledgers = ledgers, salariesBy = salaries, totals = totals(expShare = 13_000.0, revShare = 44_750.0))
        val mina = p[0]
        val ammar = p[1]
        assertEquals("mina", mina.id)
        assertEquals("Mina", mina.name)
        assertEquals(140_000.0, mina.contributed)
        assertEquals(10_000.0, mina.withdrawn)
        assertEquals(6_000.0, mina.salaryPaid)
        assertEquals(PartnerBalance(equityBalance = 90_000.0, loanBalance = 40_000.0, netPnL = 31_750.0, totalClaim = 161_750.0), mina.balance)
        assertEquals(listOf("m1", "m2"), mina.payments.map { it.id })
        assertEquals(listOf("m3"), mina.withdrawals.map { it.id })
        assertEquals(60_000.0, ammar.contributed)
        assertEquals(5_000.0, ammar.withdrawn)
        assertEquals(0.0, ammar.salaryPaid)
        assertEquals(PartnerBalance(equityBalance = 60_000.0, loanBalance = -5_000.0, netPnL = 31_750.0, totalClaim = 86_750.0), ammar.balance)
    }

    @Test
    fun testAPartnerWithNoLedgerYetStandsAtTheirHalfOfThePAndL() {
        val p = ShareholderFigures.partnerPositions(partners = partners, ledgers = emptyMap(), salariesBy = emptyMap(), totals = totals(expShare = 10_000.0, revShare = 4_000.0))
        assertEquals(-6_000.0, p[0].balance.totalClaim)
        assertEquals(emptyList(), p[0].rows)
    }

    // MARK: A ledger document (ledgerRowFrom; the read: loadLedger)

    @Test
    fun testReadsAsThePageReadsIt() {
        val r = ERPDecode.model<ShareholderLedgerRow>(
            mapOf(
                "id" to "x1", "description" to "Bank transfer", "amount" to "25000", "category" to "loan", "type" to "withdrawal", "linkedExpenseId" to "exp-1",
                "date" to "2026-09-01T00:00:00.000Z",
            ),
        )!!
        assertEquals(
            ShareholderLedgerRow(id = "x1", description = "Bank transfer", amount = 25_000.0, date = "2026-09-01T00:00:00.000Z", category = PartnerLedgerCategory.loan, type = PartnerLedgerType.withdrawal, linkedExpenseId = "exp-1"),
            r,
        )
    }

    @Test
    fun testAnEntryFromBeforeTheSplitIsEquityAnythingElseIsAPaymentAndPendingIsNoLink() {
        val r = ERPDecode.model<ShareholderLedgerRow>(mapOf("id" to "x2", "amount" to "lots", "linkedExpenseId" to "pending"))!!
        assertEquals(ShareholderLedgerRow(id = "x2", description = "", amount = 0.0, date = "", category = PartnerLedgerCategory.equity, type = PartnerLedgerType.payment, linkedExpenseId = null), r)
    }

    @Test
    fun testTheLedgerReadIsNewestFirstAndLeavesOutARowWithNoDate() {
        val rows = listOf(
            ShareholderLedgerRow(id = "old", description = "", amount = 1.0, date = "2026-01-01T00:00:00.000Z", category = PartnerLedgerCategory.equity, type = PartnerLedgerType.payment),
            ShareholderLedgerRow(id = "none", description = "", amount = 1.0, date = "", category = PartnerLedgerCategory.equity, type = PartnerLedgerType.payment),
            ShareholderLedgerRow(id = "new", description = "", amount = 1.0, date = "2026-03-01T00:00:00.000Z", category = PartnerLedgerCategory.equity, type = PartnerLedgerType.payment),
        )
        assertEquals(listOf("new", "old"), ShareholderFigures.shown(rows).map { it.id })
    }
}
