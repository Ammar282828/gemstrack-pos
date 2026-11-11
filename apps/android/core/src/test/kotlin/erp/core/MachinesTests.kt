package erp.core

import erp.core.logic.Allowed
import erp.core.logic.Machines
import erp.core.logic.MoveRefusal
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The real exported table (apps/iphone/App/Resources/machines.json), checked as src/lib/machines/machines.test.ts checks the web's. Guards are the server's: these are the table's own answers. */
class MachinesTests {
    private val coreDir = File(System.getProperty("erp.coreDir") ?: System.getProperty("user.dir")).absoluteFile
    private val t = Machines.parse(File(coreDir, "../../iphone/App/Resources/machines.json").canonicalFile.readText())

    @Test fun carriesTheFiveMachines() {
        assertEquals(listOf("Order", "Repair", "Payment link", "Website order", "TCS booking"), t.all.map { it.name })
    }

    @Test fun everyMachineIsWellFormed() {
        for (m in t.all) {
            for (s in m.states) { assertNotNull(m.labels[s], "${m.name} $s label"); assertNotNull(m.tones[s], "${m.name} $s tone") }
            for (mv in m.moves) {
                assertTrue(mv.to in m.states, "${m.name} to ${mv.to}")
                mv.from?.forEach { assertTrue(it in m.states, "${m.name} from $it") }
            }
        }
    }

    @Test fun wordsAndTones() {
        assertEquals("In the shop", t.label("Repair", "received"))
        assertEquals("working", t.tone("Order", "In Progress"))
        assertEquals("owed", t.tone("Repair", "ready"))
        assertNull(t.label("Order", "Weird"))
    }

    @Test fun orderKeepsEveryMoveTheShopMadeByHand() {
        for ((a, b) in listOf("Pending" to "In Progress", "In Progress" to "Completed", "Completed" to "In Progress", "Pending" to "Cancelled", "Cancelled" to "Pending", "Cancelled" to "Completed")) {
            assertTrue(t.can("Order", a, b), "$a to $b")
        }
    }

    @Test fun refundedIsOnlyByRefund() {
        assertFalse(t.can("Order", "Completed", "Refunded"))
        assertTrue(t.can("Order", "Completed", "Refunded", "refund"))
    }

    @Test fun refundedIsFinal() {
        assertFalse(t.can("Order", "Refunded", "Pending"))
        assertTrue(t.machine("Order")!!.isFinal("Refunded"))
        assertEquals(emptyList(), t.allowed("Order", "Refunded", "set"))
    }

    @Test fun aDeliveredParcelDoesNotReopenAClosedOrder() {
        assertFalse(t.can("Order", "Cancelled", "Completed", "delivered"))
        assertFalse(t.can("Order", "Refunded", "Completed", "delivered"))
        assertTrue(t.can("Order", "In Progress", "Completed", "delivered"))
    }

    @Test fun anInvoicedOrdersWayBackIsUndoInvoice() {
        assertTrue(t.can("Order", "Completed", "Pending", "undoInvoice"))
        assertTrue(t.can("Order", "Completed", "In Progress", "undoInvoice"))
        // the same state is a no-op the server allows
        assertTrue(t.can("Order", "Completed", "Completed"))
    }

    @Test fun aRefusalListsWhatCanHappenInstead() {
        val to = t.allowed("Order", "Cancelled").map { it.to }
        assertTrue(to.containsAll(listOf("Pending", "In Progress", "Completed")))
        assertEquals(listOf("Pending", "In Progress", "Completed"), t.machine("Order")!!.choices("Cancelled"))
    }

    @Test fun anOldUnknownStatusIsNotStuck() {
        assertTrue(t.can("Order", "Weird", "Pending"))
        assertFalse(t.can("Order", "Weird", "Refunded"))
        assertEquals(emptyList(), t.allowed("Order", "Weird"))
    }

    @Test fun repairs() {
        assertTrue(t.can("Repair", "ready", "collected"))
        assertTrue(t.machine("Repair")!!.moves.first { it.to == "collected" }.condition!!.contains("nothing owed"))
        assertTrue(t.can("Repair", "collected", "received"))
        assertTrue(t.can("Repair", "cancelled", "received"))
        assertFalse(t.can("Repair", "collected", "cancelled"))
        assertEquals(listOf("ready", "collected", "cancelled"), t.machine("Repair")!!.choices("received"))
    }

    @Test fun paymentLinkWebsiteOrderAndBooking() {
        assertTrue(t.can("Payment link", "expired", "paid", "paid"))
        assertFalse(t.can("Payment link", "paid", "open", "paid"))
        assertFalse(t.can("Website order", "confirmed", "confirming", "claim"))
        assertTrue(t.can("Website order", "pending", "declined", "decline"))
        assertTrue(t.can("TCS booking", "cancelled", "pending", "book"))
        assertTrue(t.can("TCS booking", "booked", "cancelled", "cancel"))
        assertFalse(t.can("TCS booking", "none", "cancelled", "cancel"))
        assertEquals(listOf(Allowed("cancelled", "cancel")), t.allowed("TCS booking", "booked"))
    }

    @Test fun aMachineTheTableDoesNotCarryIsLeftToTheServer() {
        assertTrue(Machines.EMPTY.can("Order", "Refunded", "Pending"))
        assertNull(Machines.EMPTY.label("Order", "Pending"))
    }

    @Test fun parsesTheRefusal() {
        val body = """{"error":"Order is Refunded, which is final.","machine":"Order","from":"Refunded","to":"Pending","allowed":[]}"""
        val r = assertNotNull(MoveRefusal.parse(body))
        assertEquals("Order is Refunded, which is final.", r.reason)
        assertEquals("Order", r.machine)
        val repair = MoveRefusal.parse("""{"error":"x","machine":"Repair","from":"ready","to":"collected","allowed":[{"to":"received","event":"set"}]}""")!!
        assertEquals(listOf(Allowed("received", "set")), repair.allowed)
        // a duplicate request's 409 is not a refused move
        assertNull(MoveRefusal.parse("""{"error":"This was already sent and is being recorded.","duplicate":true}"""))
        assertNull(MoveRefusal.parse("not json"))
    }
}
