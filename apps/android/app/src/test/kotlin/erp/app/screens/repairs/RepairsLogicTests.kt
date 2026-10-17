package erp.app.screens.repairs

import erp.core.Json
import erp.core.logic.PromiseState
import erp.core.models.Karigar
import erp.core.models.Repair
import erp.core.models.RepairStatus
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// What the Repairs screens decide, read off src/app/repairs/page.tsx and src/lib/repairs.ts. Made-up names and numbers only.
class RepairsLogicTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private fun repair(json: String): Repair = Json.decode<Repair>(json)!!

    private fun ticket(
        id: String = "REP-000001",
        status: String = "received",
        name: String = "Sana Example",
        phone: String? = "03001234567",
        promised: String? = null,
        received: String = "2026-10-01T09:00:00Z",
        ready: String? = null,
        collected: String? = null,
        pieces: String = """[{"item":"Gold ring","work":"resize to 14","price":2500}]""",
        payments: String = "[]",
        karigar: String? = null,
    ): Repair = repair(
        buildString {
            append("""{"id":"$id","status":"$status","customerName":"$name","receivedAt":"$received","pieces":$pieces,"payments":$payments""")
            if (phone != null) append(""","customerContact":"$phone"""")
            if (promised != null) append(""","promisedDate":"$promised"""")
            if (ready != null) append(""","readyAt":"$ready"""")
            if (collected != null) append(""","collectedAt":"$collected"""")
            if (karigar != null) append(""","karigarName":"$karigar"""")
            append("}")
        },
    )

    @Test fun statusWordsAndTones() {
        assertEquals("In the shop", RepairsKit.label(RepairStatus.received))
        assertEquals("Ready", RepairsKit.label(RepairStatus.ready))
        assertEquals("Collected", RepairsKit.label(RepairStatus.collected))
        assertEquals("Cancelled", RepairsKit.label(RepairStatus.cancelled))
        assertEquals("No status", RepairsKit.label(RepairStatus.unknown("")))
        assertEquals("on hold", RepairsKit.label(RepairStatus.unknown("on hold")))
        assertEquals(erp.app.ui.Tone.owed, RepairsKit.tone(RepairStatus.received))
        assertEquals(erp.app.ui.Tone.settled, RepairsKit.tone(RepairStatus.ready))
        assertEquals(erp.app.ui.Tone.quiet, RepairsKit.tone(RepairStatus.cancelled))
    }

    @Test fun aTicketWithNoNameOrTheOldWalkInNameIsAWalkIn() {
        assertEquals("Walk-in", RepairsKit.customer(ticket(name = "")))
        assertEquals("Walk-in", RepairsKit.customer(ticket(name = "  ")))
        assertEquals("Walk-in", RepairsKit.customer(ticket(name = "Walk-in Customer")))
        assertEquals("Sana Example", RepairsKit.customer(ticket()))
    }

    @Test fun gramsAndTypedFigures() {
        assertEquals("12.5 g", RepairsKit.grams(12.5))
        assertEquals("3 g", RepairsKit.grams(3.0))
        assertEquals("0.125 g", RepairsKit.grams(0.125))
        assertEquals("", RepairsKit.typed(null, 3))
        assertEquals("", RepairsKit.typed(0.0, 3))
        assertEquals("2.5", RepairsKit.typed(2.5, 3))
        assertEquals("1000", RepairsKit.typed(1000.0, 2))
        assertEquals("1000.5", RepairsKit.typed(1000.5, 2))
    }

    @Test fun byDayReadsMidSentence() {
        assertEquals("today", RepairsKit.byDay("2026-10-12T05:00:00Z", now))
        assertEquals("tomorrow", RepairsKit.byDay("2026-10-13T05:00:00Z", now))
        assertEquals("yesterday", RepairsKit.byDay("2026-10-11T05:00:00Z", now))
        assertEquals("Sat 10 Oct", RepairsKit.byDay("2026-10-10T05:00:00Z", now))
    }

    @Test fun paymentsAreSaidInALine() {
        val r = ticket(payments = """[{"amount":1000,"date":"2026-10-12T05:00:00Z","method":"Cash","note":"Advance"},{"amount":300,"date":"2026-10-11T05:00:00Z"}]""")
        assertEquals("Today · Cash · Advance", RepairsKit.paymentWords(r.payments[0], now))
        assertEquals("Yesterday", RepairsKit.paymentWords(r.payments[1], now))
    }

    @Test fun onlyAShopTicketWithADateHasTiming() {
        assertNull(RepairsKit.timing(ticket(promised = null), now))
        assertNull(RepairsKit.timing(ticket(status = "ready", promised = "2026-10-01"), now))
        val late = RepairsKit.timing(ticket(promised = "2026-10-09"), now)!!
        assertEquals(PromiseState.late, late.state)
        assertEquals(3, late.daysLate)
        assertEquals(PromiseState.today, RepairsKit.timing(ticket(promised = "2026-10-12"), now)!!.state)
        assertEquals(PromiseState.upcoming, RepairsKit.timing(ticket(promised = "2026-10-20"), now)!!.state)
        assertEquals("Ready by Fri 9 Oct · 3 days late", promiseLine(ticket(promised = "2026-10-09"), late, now))
        assertEquals("Ready by today", promiseLine(ticket(promised = "2026-10-12"), RepairsKit.timing(ticket(promised = "2026-10-12"), now)!!, now))
    }

    @Test fun searchFindsNumberNamePhoneKarigarAndPieces() {
        val r = ticket(id = "REP-000012", name = "Hira Sample", phone = "+92 300 0000103", karigar = "Ustad Demo",
            pieces = """[{"item":"Chain","work":"clasp replaced"}]""")
        for (q in listOf("rep-000012", "hira", "ustad", "chain", "clasp", "0000103", "300-0000103", "+92 300 0000")) assertTrue(RepairsKit.matches(r, q), q)
        assertTrue(!RepairsKit.matches(r, "zzz"))
        // Two digits is not a phone search.
        assertTrue(!RepairsKit.matches(r, "99"))
    }

    @Test fun theListGroupsByStatusInShopByPromiseThenTheLatest() {
        val a = ticket(id = "REP-000001", promised = "2026-10-20")
        val b = ticket(id = "REP-000002", promised = "2026-10-15")
        val c = ticket(id = "REP-000003", promised = null)
        val d = ticket(id = "REP-000004", status = "ready", ready = "2026-10-05T09:00:00Z")
        val e = ticket(id = "REP-000005", status = "ready", ready = "2026-10-08T09:00:00Z")
        val f = ticket(id = "REP-000006", status = "collected", collected = "2026-10-09T09:00:00Z")
        val g = ticket(id = "REP-000007", status = "cancelled")
        val h = ticket(id = "REP-000008", status = "on hold")
        val groups = RepairsKit.groups(listOf(a, c, d, g, e, f, b, h))
        assertEquals(listOf("received", "ready", "collected", "cancelled", "other"), groups.map { it.id })
        assertEquals(listOf("In the shop", "Ready", "Collected", "Cancelled", "Other"), groups.map { it.title })
        assertEquals(listOf("REP-000002", "REP-000001", "REP-000003"), groups[0].rows.map { it.id })
        assertEquals(listOf("REP-000005", "REP-000004"), groups[1].rows.map { it.id })
        assertEquals(listOf(false, false, true, true, true), groups.map { it.folded })
        assertEquals(emptyList(), RepairsKit.groups(emptyList()).map { it.id })
    }

    @Test fun whatATicketStillAllows() {
        assertTrue(RepairsKit.hasActions(ticket()))
        assertTrue(RepairsKit.hasActions(ticket(status = "ready")))
        assertTrue(RepairsKit.hasActions(ticket(status = "collected")))
        assertTrue(!RepairsKit.hasActions(ticket(status = "collected", payments = """[{"amount":2500,"date":"2026-10-03T09:00:00Z"}]""")))
        assertTrue(!RepairsKit.hasActions(ticket(status = "cancelled")))
    }

    @Test fun theTellThemMessageIsThePagesOwn() {
        val one = ticket(id = "REP-000012", status = "ready", name = "Hira Sample")
        assertEquals(
            "Assalam o Alaikum Hira Sample, your gold ring is ready for collection at Demo Shop (repair REP-000012). Balance: PKR 2,500. Please bring your receipt.",
            RepairsKit.readyMessage(one, "Demo Shop"),
        )
        val two = ticket(
            id = "REP-000013", status = "ready", name = "", pieces = """[{"item":"Ring","price":100},{"item":"Chain","price":50}]""",
            payments = """[{"amount":150,"date":"2026-10-03T09:00:00Z"}]""",
        )
        assertEquals(
            "Assalam o Alaikum, your 2 pieces are ready for collection at Demo Shop (repair REP-000013). Please bring your receipt.",
            RepairsKit.readyMessage(two, "Demo Shop"),
        )
    }

    @Test fun whatsAppAndDialAddresses() {
        val r = ticket(id = "REP-000012", status = "ready", name = "Hira", phone = "0300 1234567", pieces = """[{"item":"Chain","price":0}]""")
        val url = RepairsKit.whatsAppUrl(r, "Demo Shop")!!
        assertTrue(url.startsWith("https://wa.me/923001234567?text=Assalam%20o%20Alaikum%20Hira%2C%20your%20chain%20is%20ready"), url)
        assertTrue(url.endsWith("Please%20bring%20your%20receipt."), url)
        assertNull(RepairsKit.whatsAppUrl(ticket(phone = null), "Demo Shop"))
        assertEquals("tel:+923001234567", RepairsKit.callUri(" +92 300-1234567 "))
        assertNull(RepairsKit.callUri("abc"))
        assertNull(RepairsKit.callUri(null))
    }

    @Test fun phonesAreSavedWithTheirCountryCode() {
        assertEquals("+923001234567", RepairsKit.normalizePhone("0300 123-4567"))
        assertEquals("+923001234567", RepairsKit.normalizePhone("923001234567"))
        assertEquals("+971501234567", RepairsKit.normalizePhone("+971 50 123 4567"))
        assertEquals("123", RepairsKit.normalizePhone("123"))
        assertEquals("", RepairsKit.normalizePhone(null))
    }

    @Test fun theErpPagePathAndQueryReading() {
        assertEquals("/repairs?id=REP-000012&web=1", RepairsKit.webPath("REP-000012"))
        assertEquals("/repairs?id=REP%201&web=1", RepairsKit.webPath("REP 1"))
        assertEquals("1", RepairsKit.query("new", "/repairs?new=1"))
        assertEquals("REP-000012", RepairsKit.query("id", "/repairs?id=REP-000012"))
        assertEquals("REP 1", RepairsKit.query("id", "/repairs?id=REP%201"))
        assertNull(RepairsKit.query("id", "/repairs"))
    }

    @Test fun theQuickDatesAreKarachisDays() {
        assertEquals("2026-10-19", RepairsKit.day(7, now))
        // 22:00 UTC is already the next morning in Karachi.
        assertEquals("2026-10-13", RepairsKit.day(0, Instant.parse("2026-10-12T22:00:00Z")))
    }

    // MARK: The form

    private fun karigar(id: String, name: String): Karigar = Json.decode<Karigar>("""{"id":"$id","name":"$name"}""")!!

    @Test fun numbersTypedInTheForm() {
        assertEquals(1500.0, RepairsFormLogic.number("1,500"))
        assertEquals(2.5, RepairsFormLogic.number(" 2.5 "))
        assertNull(RepairsFormLogic.number(""))
        assertNull(RepairsFormLogic.number("0"))
        assertNull(RepairsFormLogic.number("-4"))
        assertNull(RepairsFormLogic.number("abc"))
    }

    @Test fun anEmptyPieceIsDroppedAndAWorkOnlyPieceIsCalledPiece() {
        val v = RepairsFormValues(
            name = "  Sana Example ", phone = " 0300 1234567 ", hasDate = true, promised = "2026-10-19", takenBy = " Demo ", note = " fragile ",
            pieces = listOf(
                RepairsDraftPiece(0, item = " Gold ring ", work = "resize", weight = "3.250", price = "2,500"),
                RepairsDraftPiece(1),
                RepairsDraftPiece(2, work = "polish"),
            ),
            karigarId = "KAR-1", advance = "1000", method = "Card",
        )
        val p = RepairsFormLogic.payload(v, listOf(karigar("KAR-1", "Ustad Demo")))
        assertEquals("Sana Example", p["customerName"])
        assertEquals("+923001234567", p["customerContact"])
        assertEquals("2026-10-19", p["promisedDate"])
        assertEquals("KAR-1", p["karigarId"])
        assertEquals("Ustad Demo", p["karigarName"])
        assertEquals("Demo", p["takenBy"])
        assertEquals("fragile", p["internalNote"])
        assertEquals(1000.0, p["advance"])
        assertEquals("Card", p["advanceMethod"])
        assertTrue(!p.containsKey("customerId"))
        assertEquals(
            listOf(
                mapOf("item" to "Gold ring", "work" to "resize", "weightG" to 3.25, "price" to 2500.0),
                mapOf("item" to "Piece", "work" to "polish"),
            ),
            p["pieces"],
        )
    }

    @Test fun anEditSendsNoAdvanceAndABlankNameStaysBlank() {
        val v = RepairsFormValues(
            customerId = "CUST-1", name = "", hasDate = false, advance = "500", editing = true,
            pieces = listOf(RepairsDraftPiece(0, item = "Ring")),
        )
        val p = RepairsFormLogic.payload(v, emptyList())
        assertEquals("", p["customerName"])
        assertEquals("CUST-1", p["customerId"])
        for (k in listOf("promisedDate", "advance", "advanceMethod", "karigarId", "takenBy", "internalNote", "customerContact")) {
            assertTrue(!p.containsKey(k), k)
        }
    }

    @Test fun theFormNeedsAPieceAndSumsItsPrices() {
        assertTrue(!RepairsFormLogic.hasPiece(listOf(RepairsDraftPiece(0))))
        assertTrue(RepairsFormLogic.hasPiece(listOf(RepairsDraftPiece(0, work = "polish"))))
        assertEquals(3_501.0, RepairsFormLogic.total(listOf(RepairsDraftPiece(0, price = "2,500"), RepairsDraftPiece(1, price = "1000.5"), RepairsDraftPiece(2, price = "x"))))
    }
}
