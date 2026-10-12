package erp.core

import erp.core.logic.CategorisedLedger
import erp.core.logic.PartnerBalance
import erp.core.logic.PartnerDistributionInput
import erp.core.logic.PartnerDistributionResult
import erp.core.logic.Partnership
import erp.core.models.PartnerLedgerCategory
import erp.core.models.PartnerLedgerType
import erp.core.models.PartnershipSettings
import erp.core.models.ShareholderLedgerRow
import java.time.Instant
import java.time.LocalDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/partnership.test.ts, case for case. All names and amounts made up. */
class PartnershipTests {
    private fun karachi(y: Int, m: Int, d: Int, h: Int = 12): Instant = LocalDateTime.of(y, m, d, h, 0).toInstant(ERPDate.karachi)

    private fun entry(amount: Double, category: PartnerLedgerCategory, type: PartnerLedgerType = PartnerLedgerType.payment) =
        ShareholderLedgerRow(id = amount.toString(), description = "Test entry", amount = amount, date = "2026-09-15T07:00:00.000Z", category = category, type = type)

    private fun floor(lastSet: String?) = PartnershipSettings(workingCapitalFloor = 1.0, floorLastSetAt = lastSet, floorHistory = emptyList())

    // MARK: What counts as a cost

    @Test
    fun testADrawingIsNotACostOfTheBusinessASalaryIs() {
        assertFalse(Partnership.isBusinessCost(category = Partnership.partnerDrawings))
        assertTrue(Partnership.isBusinessCost(category = Partnership.partnerSalary))
        assertTrue(Partnership.isBusinessCost(category = "Rent"))
        assertTrue(Partnership.isBusinessCost(category = null))
        assertEquals("Partner Drawings", Partnership.partnerDrawings)
        assertEquals("Partner Salary", Partnership.partnerSalary)
    }

    // MARK: A partner's ledger

    @Test
    fun testSortsPaymentsAndWithdrawalsIntoEquityAndLoan() {
        val l = Partnership.categorise(
            payments = listOf(entry(100_000.0, PartnerLedgerCategory.equity), entry(40_000.0, PartnerLedgerCategory.loan), entry(25_000.0, PartnerLedgerCategory.equity)),
            withdrawals = listOf(entry(10_000.0, PartnerLedgerCategory.equity, PartnerLedgerType.withdrawal), entry(15_000.0, PartnerLedgerCategory.loan, PartnerLedgerType.withdrawal)),
        )
        assertEquals(CategorisedLedger(equityIn = 125_000.0, loanIn = 40_000.0, equityOut = 10_000.0, loanOut = 15_000.0), l)
        assertEquals(CategorisedLedger(), Partnership.categorise(payments = emptyList(), withdrawals = emptyList()))
    }

    @Test
    fun testAClaimIsTheLoanTheEquityAndTheHalfOfProfitAndLossTogether() {
        val b = Partnership.partnerBalance(CategorisedLedger(equityIn = 125_000.0, loanIn = 40_000.0, equityOut = 10_000.0, loanOut = 15_000.0), expShare = 60_000.0, revShare = 90_000.0)
        assertEquals(PartnerBalance(equityBalance = 115_000.0, loanBalance = 25_000.0, netPnL = 30_000.0, totalClaim = 170_000.0), b)
    }

    @Test
    fun testALossIsAbsorbedAgainstTheClaim() {
        val b = Partnership.partnerBalance(CategorisedLedger(equityIn = 50_000.0), expShare = 80_000.0, revShare = 20_000.0)
        assertEquals(PartnerBalance(equityBalance = 50_000.0, loanBalance = 0.0, netPnL = -60_000.0, totalClaim = -10_000.0), b)
    }

    // MARK: The distribution waterfall

    private val partners = listOf(
        PartnerDistributionInput(name = "Partner A", loanBalance = 30_000.0, equityBalance = 100_000.0, netPnL = 5000.0),
        PartnerDistributionInput(name = "Partner B", loanBalance = 10_000.0, equityBalance = 80_000.0, netPnL = 5000.0),
    )

    @Test
    fun testHoldsBackTheFloorRepaysTheLoansThenSplitsTheRestEqually() {
        val d = Partnership.calculateDistribution(cashOnHand = 600_000.0, workingCapitalFloor = 500_000.0, partners = partners)
        assertEquals(100_000.0, d.distributableCash)
        assertEquals(40_000.0, d.totalLoanOutstanding)
        assertEquals(40_000.0, d.loanRepaymentsTotal)
        assertEquals(60_000.0, d.profitPoolTotal)
        assertEquals(
            listOf(
                PartnerDistributionResult(name = "Partner A", loanRepayment = 30_000.0, profitShare = 30_000.0, equityDraw = 30_000.0, total = 60_000.0),
                PartnerDistributionResult(name = "Partner B", loanRepayment = 10_000.0, profitShare = 30_000.0, equityDraw = 30_000.0, total = 40_000.0),
            ),
            d.perPartner,
        )
        assertEquals(0.0, d.remainingAfter)
        assertTrue(d.feasible)
        assertEquals(0.0, d.shortfallToFirstDistribution)
    }

    @Test
    fun testNotEnoughForTheLoansEachIsRepaidInProportionAndNothingIsSplit() {
        val d = Partnership.calculateDistribution(cashOnHand = 520_000.0, workingCapitalFloor = 500_000.0, partners = partners)
        assertEquals(20_000.0, d.loanRepaymentsTotal)
        assertEquals(listOf(15_000.0, 5000.0), d.perPartner.map { it.loanRepayment })
        assertEquals(0.0, d.profitPoolTotal)
        assertEquals(listOf(15_000.0, 5000.0), d.perPartner.map { it.total })
    }

    @Test
    fun testBelowTheFloorNothingToGiveAndHowFarShortItIs() {
        val d = Partnership.calculateDistribution(cashOnHand = 350_000.0, workingCapitalFloor = 500_000.0, partners = partners)
        assertEquals(0.0, d.distributableCash)
        assertFalse(d.feasible)
        assertEquals(150_000.0, d.shortfallToFirstDistribution)
        assertEquals(listOf(0.0, 0.0), d.perPartner.map { it.total })
    }

    @Test
    fun testALoanTheBusinessIsOwedBackCountsForNothingOutstanding() {
        val d = Partnership.calculateDistribution(
            cashOnHand = 100_000.0, workingCapitalFloor = 0.0,
            partners = listOf(
                PartnerDistributionInput(name = "Partner A", loanBalance = -20_000.0, equityBalance = 0.0, netPnL = 0.0),
                PartnerDistributionInput(name = "Partner B", loanBalance = 0.0, equityBalance = 0.0, netPnL = 0.0),
            ),
        )
        assertEquals(0.0, d.totalLoanOutstanding)
        assertEquals(0.0, d.loanRepaymentsTotal)
        assertEquals(listOf(50_000.0, 50_000.0), d.perPartner.map { it.profitShare })
    }

    @Test
    fun testRatiosGivenForEveryPartnerSplitThePoolByThem() {
        val none = listOf(
            PartnerDistributionInput(name = "Partner A", loanBalance = 0.0, equityBalance = 0.0, netPnL = 0.0),
            PartnerDistributionInput(name = "Partner B", loanBalance = 0.0, equityBalance = 0.0, netPnL = 0.0),
        )
        val d = Partnership.calculateDistribution(cashOnHand = 100_000.0, workingCapitalFloor = 0.0, partners = none, distributionRatios = listOf(3.0, 1.0))
        assertEquals(listOf(75_000.0, 25_000.0), d.perPartner.map { it.profitShare })
        // A ratio list of the wrong length is ignored: equal shares.
        assertEquals(
            listOf(50_000.0, 50_000.0),
            Partnership.calculateDistribution(cashOnHand = 100_000.0, workingCapitalFloor = 0.0, partners = none, distributionRatios = listOf(1.0)).perPartner.map { it.profitShare },
        )
    }

    // MARK: The working-capital floor

    @Test
    fun testStartsAtFiveLac() {
        assertEquals(500_000.0, Partnership.defaultWorkingCapitalFloor)
        assertEquals(500_000.0, ERPDecode.model<PartnershipSettings>(mapOf("workingCapitalFloor" to 0))?.workingCapitalFloor)
        assertEquals(500_000.0, ERPDecode.model<PartnershipSettings>(emptyMap<String, Any?>())?.workingCapitalFloor)
        val s = ERPDecode.model<PartnershipSettings>(
            mapOf(
                "workingCapitalFloor" to 300_000, "floorLastSetAt" to "2026-10-01T05:00:00.000Z",
                "floorHistory" to listOf(mapOf("value" to 300_000, "date" to "2026-10-01T05:00:00.000Z", "by" to "Shareholders")),
            ),
        )!!
        assertEquals(300_000.0, s.workingCapitalFloor)
        assertEquals("2026-10-01T05:00:00.000Z", s.floorLastSetAt)
        assertEquals("Shareholders", s.floorHistory.firstOrNull()?.by)
    }

    @Test
    fun testIsStaleUntilItHasBeenSetThisCalendarMonth() {
        val now = karachi(2026, 10, 3)
        assertTrue(Partnership.isFloorStale(floor(lastSet = null), now = now))
        assertTrue(Partnership.isFloorStale(floor(lastSet = "never"), now = now))
        assertTrue(Partnership.isFloorStale(floor(lastSet = ERPDate.iso(karachi(2026, 9, 28))), now = now))
        assertTrue(Partnership.isFloorStale(floor(lastSet = ERPDate.iso(karachi(2025, 10, 2))), now = now))
        assertFalse(Partnership.isFloorStale(floor(lastSet = ERPDate.iso(karachi(2026, 10, 1))), now = now))
    }

    @Test
    fun testAsksToBeReviewedInTheFirstFiveDaysOfAMonth() {
        assertTrue(Partnership.isMonthStart(now = karachi(2026, 10, 1)))
        assertTrue(Partnership.isMonthStart(now = karachi(2026, 10, 5)))
        assertFalse(Partnership.isMonthStart(now = karachi(2026, 10, 6)))
    }
}
