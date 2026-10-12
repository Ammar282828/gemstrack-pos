package erp.app.screens.repairs

import erp.app.data.Demo
import erp.core.ERPDecode
import erp.core.logic.repairBalance
import erp.core.logic.repairPaid
import erp.core.logic.repairSummary
import erp.core.logic.repairTotal
import erp.core.models.Repair
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The Repairs screens render from the demo books (CONVENTIONS.md rule 13): the demo's tickets group, search, sum and say
// their words, and the form's payload and the ready message work out for each. (No screenshot harness yet.)
class DemoRepairsTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private val repairs: List<Repair> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now).getValue("repairs").map { ERPDecode.model<Repair>(it)!! }
    }

    @Test fun theDemoHasTicketsToShow() {
        assertTrue(repairs.size >= 2)
        assertTrue(repairs.all { it.id.isNotEmpty() })
    }

    @Test fun everyTicketIsInOneGroupAndHasItsWords() {
        val groups = RepairsKit.groups(repairs)
        assertEquals(repairs.map { it.id }.sorted(), groups.flatMap { g -> g.rows.map { it.id } }.sorted())
        for (r in repairs) {
            assertTrue(repairSummary(r).isNotEmpty())
            assertTrue(RepairsKit.label(r.status).isNotEmpty())
            assertTrue(RepairsKit.customer(r).isNotEmpty())
            assertTrue(who(r).isNotEmpty())
            assertTrue(facts(r, now).startsWith(r.id))
            assertEquals(repairTotal(r) - repairPaid(r) > 0, repairBalance(r) > 0)
            RepairsKit.timing(r, now)
            RepairsKit.hasActions(r)
            assertTrue(RepairsKit.matches(r, r.id.lowercase()))
            assertTrue(RepairsKit.matches(r, r.customerName.lowercase()))
            for (p in r.payments) assertTrue(RepairsKit.paymentWords(p, now).isNotEmpty())
            assertTrue(RepairsKit.webPath(r.id).startsWith("/repairs?id="))
        }
    }

    @Test fun theInShopTicketIsOnTheListWithItsPromiseAndTheReadyOneCanBeToldAbout() {
        val inShop = repairs.first { it.id == "REP-D1" }
        assertEquals("Chain", repairSummary(inShop))
        assertEquals(1_500.0, repairBalance(inShop))
        assertTrue(RepairsKit.timing(inShop, now) != null)
        val ready = repairs.first { it.id == "REP-D2" }
        assertEquals("Ring + 1 more", repairSummary(ready))
        // 2,500 + 800 less the 1,000 advance.
        assertEquals(2_300.0, repairBalance(ready))
        val message = RepairsKit.readyMessage(ready, "Demo Shop")
        assertTrue(message.contains("your 2 pieces are ready for collection at Demo Shop (repair REP-D2). Balance: PKR 2,300."), message)
        assertTrue(RepairsKit.whatsAppUrl(ready, "Demo Shop")!!.startsWith("https://wa.me/923000000105?text="))
    }

    @Test fun anEditOfEachTicketRebuildsItsPayload() {
        for (r in repairs) {
            val pieces = r.pieces.mapIndexed { i, p ->
                RepairsDraftPiece(i.toLong(), p.item, p.work, RepairsKit.typed(p.weightG, 3), RepairsKit.typed(p.price, 2))
            }
            val values = RepairsFormValues(
                customerId = r.customerId, name = r.customerName, phone = r.customerContact ?: "", pieces = pieces,
                hasDate = r.promisedDate != null, promised = r.promisedDate ?: "", editing = true,
            )
            @Suppress("UNCHECKED_CAST")
            val sent = RepairsFormLogic.payload(values, emptyList())["pieces"] as List<Map<String, Any?>>
            assertEquals(r.pieces.size, sent.size)
            assertEquals(r.pieces.sumOf { it.price ?: 0.0 }, sent.sumOf { (it["price"] as? Double) ?: 0.0 })
        }
    }
}
