package erp.core

import erp.core.logic.BalanceLine
import erp.core.logic.BalanceState
import erp.core.logic.balanceLine
import erp.core.logic.canHoldCredit
import erp.core.logic.creditDescription
import erp.core.logic.inCredit
import erp.core.logic.isCreditRow
import erp.core.models.HisaabEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/invoice-credit.test.ts, case for case. */
class InvoiceCreditTests {
    private fun row(fields: Map<String, Any?>): HisaabEntry = ERPDecode.model<HisaabEntry>(fields)!!

    @Test
    fun testReadsAsDuePaidOrCreditWithPaiseEitherWaySettled() {
        assertEquals(BalanceLine(label = "Balance due", amount = 5_000.0, state = BalanceState.due), balanceLine(5_000.0))
        assertEquals(BalanceLine(label = "Credit to customer", amount = 5_000.0, state = BalanceState.credit), balanceLine(-5_000.0))
        assertEquals(BalanceState.paid, balanceLine(0.3).state)
        assertEquals(BalanceState.paid, balanceLine(-0.3).state)
        assertEquals(BalanceState.paid, balanceLine(null).state)
        assertTrue(inCredit(-1.0))
        assertFalse(inCredit(-0.4))
    }

    @Test
    fun testHeldOnlyForSomeoneNamed() {
        assertTrue(canHoldCredit("c1"))
        assertFalse(canHoldCredit("walk-in"))
        assertFalse(canHoldCredit(""))
        assertFalse(canHoldCredit(null))
    }

    @Test
    fun testKnowsItsLedgerRowAndTheOneTheSyncUsedToWrite() {
        assertTrue(isCreditRow(row(mapOf("description" to creditDescription("INV-1"), "cashCredit" to 5)), "INV-1"))
        assertTrue(isCreditRow(row(mapOf("description" to "Excess advance returned for Invoice INV-1", "cashCredit" to 5)), "INV-1"))
        assertFalse(isCreditRow(row(mapOf("description" to creditDescription("INV-2"), "cashCredit" to 5)), "INV-1"))
        assertFalse(isCreditRow(row(mapOf("description" to "Outstanding balance for Invoice INV-1", "cashDebit" to 5)), "INV-1"))
    }
}
