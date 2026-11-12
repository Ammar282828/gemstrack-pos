package erp.core

import erp.core.logic.Machines
import erp.core.logic.Settlement
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

// src/lib/machines/settlement.test.ts, case for case: one derivation of due / partly / paid / credit / refunded.
class SettlementTests {
    @Test fun owingWithNothingPaidIsDueWithSomethingPaidIsPartly() {
        assertEquals(Settlement("due", 5000.0, 0.0), Settlement.of(null, 5000.0, 0.0))
        assertEquals("Balance due", Settlement.of(null, 5000.0, 0.0).label)
        assertEquals(Settlement("partly", 3000.0, 0.0), Settlement.of(null, 3000.0, 2000.0))
    }

    @Test fun zeroAndAnythingUnderARupeeIsPaid() {
        for (b in listOf(0.0, 0.4, -0.4, null)) assertEquals(Settlement("paid", 0.0, 0.0), Settlement.of(null, b))
        assertEquals("Paid in full", Settlement.of(null, null).label)
    }

    @Test fun belowZeroIsTheCustomersCredit() {
        assertEquals(Settlement("credit", 0.0, 5000.0), Settlement.of(null, -5000.0))
        assertEquals("Credit to customer", Settlement.of(null, -5000.0).label)
        assertEquals("credit", Settlement.of(null, -1.0).state)
    }

    @Test fun refundedWinsOverTheBalance() {
        assertEquals(Settlement("refunded", 0.0, 0.0), Settlement.of("Refunded", 11850.0, 0.0))
        assertEquals("Refunded", Settlement.of("Refunded", 11850.0, 0.0).label)
        assertEquals(Settlement("refunded", 0.0, 0.0), Settlement.of("Refunded", -400.0))
    }

    @Test fun everyStateHasALabelAndATone() {
        for (s in Settlement.STATES) { assert(Settlement.LABELS.getValue(s).isNotEmpty()); assert(Settlement.TONES.getValue(s).isNotEmpty()) }
    }

    @Test fun theTableCarriesTheSameDerivedMachine() {
        val core = File(System.getProperty("erp.coreDir") ?: System.getProperty("user.dir")).absoluteFile
        val file = File(core, "../../iphone/App/Resources/machines.json").canonicalFile
        val m = Machines.parse(file.readText()).machine(Machines.INVOICE_SETTLEMENT)!!
        assertEquals(Settlement.STATES, m.states)
        assertEquals(Settlement.LABELS, m.labels)
        assertEquals(Settlement.TONES, m.tones)
    }
}
