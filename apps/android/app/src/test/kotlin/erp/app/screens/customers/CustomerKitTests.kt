package erp.app.screens.customers

import erp.core.models.Customer
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Repair
import erp.core.models.RepairStatus
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Made-up customers, invoices and orders for the Customers tests: no real names, numbers or amounts. */
internal object CustFix {
    fun customer(id: String, name: String, phone: String? = null, extra: Map<String, Any?> = emptyMap()): Customer =
        Customer.fromMap(mapOf("id" to id, "name" to name, "phone" to phone) + extra)

    fun invoice(id: String, customerId: String?, total: Double, due: Double, at: String, name: String = "", status: String? = null): Invoice =
        Invoice.fromMap(
            mapOf(
                "id" to id, "customerId" to customerId, "customerName" to name, "grandTotal" to total, "subtotal" to total,
                "amountPaid" to total - due, "balanceDue" to due, "createdAt" to at, "items" to listOf(mapOf("sku" to "RNG-1", "itemTotal" to total)),
            ) + (if (status != null) mapOf("status" to status) else emptyMap()),
        )

    fun order(id: String, customerId: String?, subtotal: Double, at: String, status: String = "Pending", invoiceId: String? = null): Order =
        Order.fromMap(mapOf("id" to id, "customerId" to customerId, "subtotal" to subtotal, "grandTotal" to subtotal, "createdAt" to at, "status" to status, "invoiceId" to invoiceId))

    fun hisaab(id: String, entityId: String, debit: Double, credit: Double = 0.0, linked: String? = null): HisaabEntry =
        HisaabEntry.fromMap(mapOf("id" to id, "entityId" to entityId, "entityType" to "customer", "entityName" to "X", "date" to "2026-09-01T00:00:00.000Z", "cashDebit" to debit, "cashCredit" to credit, "linkedInvoiceId" to linked))
}

class CustomerKitTests {
    @Test fun pathsMatchTheIphonesRoutes() {
        assertEquals("CUST-1", CustomerKit.id("/customers/CUST-1"))
        assertEquals("a b", CustomerKit.id("/customers/a%20b"))
        assertNull(CustomerKit.id("/customers"))
        assertNull(CustomerKit.id("/customers/add"))
        assertNull(CustomerKit.id("/customers/CUST-1/edit"))
        assertNull(CustomerKit.id("/customers/CUST-1?web=1"))
        assertEquals("CUST-1", CustomerKit.editId("/customers/CUST-1/edit"))
        assertNull(CustomerKit.editId("/customers/CUST-1/edit?web=1"))
        assertNull(CustomerKit.editId("/customers/CUST-1"))
        assertNull(CustomerKit.editId("/customers//edit"))
        assertTrue(CustomerKit.isList("/customers"))
        assertFalse(CustomerKit.isList("/customers?web=1"))
        assertTrue(CustomerKit.asksForWeb("/customers?x=1&web=1"))
        assertFalse(CustomerKit.asksForWeb("/customers?web=10"))
    }

    @Test fun anIdIsOnePathPiece() {
        assertEquals("CUST-1", CustomerKit.piece("CUST-1"))
        assertEquals("%23101", CustomerKit.piece("#101"))
        assertEquals("a%2Fb%20c", CustomerKit.piece("a/b c"))
        assertEquals("/customers/CUST-1/edit", CustomerKit.path("CUST-1", "/edit"))
        assertEquals("/hisaab/CUST-1?type=customer", CustomerKit.hisaabPath("CUST-1"))
        assertEquals("/repairs?id=REP-000001", CustomerKit.place("/repairs?id=", "REP-000001"))
    }

    @Test fun theRoutesPickTheRightScreen() {
        fun matches(path: String) = CustomersRoutes.map { it.matches(path) }
        assertEquals(listOf(true, false, false, false), matches("/customers"))
        assertEquals(listOf(false, true, false, false), matches("/customers/add"))
        assertEquals(listOf(false, false, true, false), matches("/customers/CUST-1/edit"))
        assertEquals(listOf(false, false, false, true), matches("/customers/CUST-1"))
        assertEquals(listOf(false, false, false, false), matches("/customers?web=1"))
        assertEquals(listOf(false, false, false, false), matches("/customers/CUST-1/edit?web=1"))
    }

    @Test fun phoneLinks() {
        assertEquals("+923001234567", CustomerKit.dialable(" +92 300-123 4567 "))
        assertEquals("03001234567", CustomerKit.dialable("0300 1234567"))
        assertEquals("tel:03001234567", CustomerKit.callUri("0300 1234567"))
        assertEquals("smsto:03001234567", CustomerKit.messageUri("0300 1234567"))
        assertEquals("https://wa.me/923001234567", CustomerKit.whatsAppUri("0300 1234567"))
        assertNull(CustomerKit.callUri(null))
        assertNull(CustomerKit.whatsAppUri("  "))
    }

    @Test fun words() {
        assertEquals("Unnamed customer", CustomerKit.shown(CustFix.customer("c", "  ")))
        assertEquals("Sana Demo", CustomerKit.shown(CustFix.customer("c", "Sana Demo")))
        assertEquals("Taheri Spillover", CustomerKit.sourceLabel(erp.core.models.CustomerSource.taheriSpillover))
        assertEquals("Walk-in", CustomerKit.sourceLabel(erp.core.models.CustomerSource.walkin))
        assertEquals("odd", CustomerKit.sourceLabel(erp.core.models.CustomerSource.unknown("odd")))
        assertEquals(6, CustomerKit.sources.size)
        assertEquals("Oct 2026", CustomerKit.monthYear("2026-10-08T06:00:00.000Z"))
        assertEquals("", CustomerKit.monthYear(null))
        assertEquals("6 Oct 1990", CustomerKit.day("1990-10-06"))
        assertEquals("sometime", CustomerKit.day(" sometime "))
        assertEquals("14.25", CustomerKit.grams(14.25))
        assertEquals("3", CustomerKit.grams(3.0))
    }

    @Test fun emailIsLooselyChecked() {
        assertTrue(CustomerKit.validEmail(""))
        assertTrue(CustomerKit.validEmail("  "))
        assertTrue(CustomerKit.validEmail("a@b.co"))
        assertFalse(CustomerKit.validEmail("a@b"))
        assertFalse(CustomerKit.validEmail("@b.co"))
        assertFalse(CustomerKit.validEmail("a b@c.co"))
        assertFalse(CustomerKit.validEmail("a@@b.co"))
    }

    @Test fun removedCustomersAreOutOfEveryList() {
        assertTrue(CustomerKit.isRemoved(CustFix.customer("c", "A", extra = mapOf("deletedAt" to "2026-01-01T00:00:00.000Z"))))
        assertFalse(CustomerKit.isRemoved(CustFix.customer("c", "A")))
    }

    @Test fun theListSearchesNamePhoneAndEmail() {
        val c = CustFix.customer("c", "Sana Demo", "0300 1234567", mapOf("email" to "Sana@Example.com"))
        assertTrue(CustomerKit.matches(c, ""))
        assertTrue(CustomerKit.matches(c, " sana "))
        assertTrue(CustomerKit.matches(c, "1234"))
        assertTrue(CustomerKit.matches(c, "example.COM"))
        assertFalse(CustomerKit.matches(c, "bilal"))
    }

    // The books: Sana owes 30k on one invoice and 5k in the hisaab, Bilal has paid up, Zoya only bought long ago.
    private val now = Instant.parse("2026-10-12T05:00:00Z")
    private val customers = listOf(
        CustFix.customer("c1", "Sana Demo", "0300 1111111"),
        CustFix.customer("c2", "Bilal Example", "0300 2222222"),
        CustFix.customer("c3", "Zoya Sample", "0300 3333333"),
        CustFix.customer("c4", "Aamir Nobody"),
        CustFix.customer("c5", "Gone Demo", extra = mapOf("deletedAt" to "2026-09-01T00:00:00.000Z")),
    )
    private val invoices = listOf(
        CustFix.invoice("INV-1", "c1", 100_000.0, 30_000.0, "2026-10-01T06:00:00.000Z"),
        CustFix.invoice("INV-2", "c2", 50_000.0, 0.0, "2026-09-15T06:00:00.000Z"),
        CustFix.invoice("INV-3", "c3", 20_000.0, 0.0, "2025-02-01T06:00:00.000Z"),
        CustFix.invoice("INV-4", null, 10_000.0, 10_000.0, "2026-10-02T06:00:00.000Z", name = "Walk-in Customer"),
        CustFix.invoice("INV-5", null, 8_000.0, 8_000.0, "2026-10-03T06:00:00.000Z", name = "Typed Name"),
        CustFix.invoice("INV-6", "c2", 9_000.0, 9_000.0, "2026-10-04T06:00:00.000Z", status = "Refunded"),
    )
    private val orders = listOf(
        CustFix.order("ORD-1", "c4", 12_000.0, "2026-10-05T06:00:00.000Z"),
        CustFix.order("ORD-2", "c4", 99_000.0, "2026-10-06T06:00:00.000Z", status = "Cancelled"),
        CustFix.order("ORD-3", "c4", 77_000.0, "2026-10-07T06:00:00.000Z", invoiceId = "INV-X"),
    )
    private val ledger = listOf(CustFix.hisaab("H1", "c1", 5_000.0), CustFix.hisaab("H2", "c1", 40_000.0, linked = "INV-1"))

    @Test fun owedIsTheErpsOneFigure() {
        val staff = CustomerKit.owed(invoices, customers, null)
        // The refunded invoice owes nothing; the walk-in and the typed name are in the total but on their own lines.
        assertEquals(30_000.0 + 10_000.0 + 8_000.0, staff.total)
        assertEquals(10_000.0, staff.walkIn)
        assertEquals(8_000.0, staff.nameOnly)
        assertEquals(0.0, staff.ledger)
        val owner = CustomerKit.owed(invoices, customers, ledger)
        // The hisaab's hand-written 5k is added; the row linked to an invoice is that invoice's balance again.
        assertEquals(5_000.0, owner.ledger)
        assertEquals(53_000.0, owner.total)
    }

    // 26eb7e5: a customer's spend counts the gold they handed over, as Analytics does.
    @Test fun spentCountsExchangedGold() {
        val withGold = Invoice.fromMap(mapOf("id" to "INV-X", "customerId" to "c1", "grandTotal" to 20_000, "subtotal" to 50_000, "amountPaid" to 20_000, "balanceDue" to 0, "createdAt" to "2026-10-01T06:00:00.000Z", "items" to emptyList<Any>(), "exchanges" to listOf(mapOf("description" to "old chain", "value" to 30_000))))
        val stats = CustomerKit.stats(listOf(withGold), emptyList(), CustomerKit.owed(listOf(withGold), emptyList(), emptyList()))
        assertEquals(50_000.0, stats.getValue("c1").spent)
    }

    @Test fun statsCountSalesAndOpenOrders() {
        val owed = CustomerKit.owed(invoices, customers, ledger)
        val stats = CustomerKit.stats(invoices, orders, owed)
        assertEquals(100_000.0, stats.getValue("c1").spent)
        assertEquals(35_000.0, stats.getValue("c1").owed)
        assertEquals(1, stats.getValue("c1").count)
        assertEquals("2026-10-01T06:00:00.000Z", stats.getValue("c1").lastAt)
        // A refunded invoice is no sale; an invoiced or cancelled order is not an open one.
        assertEquals(50_000.0, stats.getValue("c2").spent)
        assertEquals(1, stats.getValue("c2").count)
        assertEquals(12_000.0, stats.getValue("c4").spent)
        assertEquals(1, stats.getValue("c4").count)
        // Walk-in and typed names have no line of their own.
        assertFalse(stats.containsKey("walk-in"))
        assertFalse(stats.keys.any { it.startsWith("name:") })
    }

    @Test fun aCustomerKnownOnlyFromTheHisaabStillOwes() {
        val owed = CustomerKit.owed(emptyList(), customers, listOf(CustFix.hisaab("H1", "c3", 7_000.0)))
        val stats = CustomerKit.stats(emptyList(), emptyList(), owed)
        assertEquals(7_000.0, stats.getValue("c3").owed)
        assertEquals(0, stats.getValue("c3").count)
    }

    @Test fun oneCustomerOwesInItsParts() {
        val owed = CustomerKit.owed(invoices, customers, ledger)
        val o = CustomerKit.owing("c1", owed, ledger)
        assertEquals(35_000.0, o.total)
        assertEquals(30_000.0, o.onInvoices)
        assertEquals(5_000.0, o.inHisaab)
        assertEquals(1, o.invoiceCount)
        assertEquals("On 1 invoice PKR 30,000 · In the hisaab PKR 5,000", owedDetail(o))
        // Staff have no hisaab: invoices alone.
        val staff = CustomerKit.owing("c1", CustomerKit.owed(invoices, customers, null), null)
        assertEquals(30_000.0, staff.total)
        assertEquals(0.0, staff.inHisaab)
        // The shop owes them: it lowers nothing and is said.
        val owes = CustomerKit.owing("c9", CustomerKit.owed(emptyList(), customers, listOf(CustFix.hisaab("H", "c9", 0.0, 9_000.0))), listOf(CustFix.hisaab("H", "c9", 0.0, 9_000.0)))
        assertEquals(9_000.0, owes.shopOwesThem)
        assertEquals(0.0, owes.total)
        assertEquals("Nothing outstanding", owedDetail(CustomerKit.Owing()))
        assertEquals("The hisaab owes them PKR 9,000", owedDetail(owes))
    }

    @Test fun groupsPutMoneyOutstandingFirst() {
        val live = customers.filter { !CustomerKit.isRemoved(it) }
        val owed = CustomerKit.owed(invoices, customers, ledger)
        val stats = CustomerKit.stats(invoices, orders, owed)
        val g = CustomerKit.groups(live, stats, now)
        assertEquals(listOf("c1"), g.owing.map { it.id })
        // Bought in the last twelve months, latest first (Aamir's open order, then Bilal's sale).
        assertEquals(listOf("c4", "c2"), g.active.map { it.id })
        assertEquals(listOf("c3"), g.quiet.map { it.id })
    }

    @Test fun owingIsMostOwedFirstAndQuietIsAToZ() {
        val people = listOf(CustFix.customer("a", "Beta"), CustFix.customer("b", "Alpha"), CustFix.customer("c", "Gamma"), CustFix.customer("d", "delta"))
        val stats = mapOf("a" to CustomerKit.Stats(owed = 10.0), "c" to CustomerKit.Stats(owed = 90.0))
        val g = CustomerKit.groups(people, stats, now)
        assertEquals(listOf("c", "a"), g.owing.map { it.id })
        assertEquals(listOf("b", "d"), g.quiet.map { it.id })
    }

    @Test fun rowWordsLeadWithWhatIsOwed() {
        val c = CustFix.customer("c1", "Sana Demo", "0300 1111111")
        val owes = CustomerKit.Stats(spent = 100_000.0, owed = 30_000.0, count = 2, lastAt = "2026-10-01T06:00:00.000Z")
        assertEquals("0300 1111111\n2 sales · last Oct 2026", custSubtitle(c, owes))
        assertEquals("PKR 30,000", custTrailing(owes))
        assertEquals(erp.core.logic.Money.pkrLac(100_000.0), custTrailing(CustomerKit.Stats(spent = 100_000.0)))
        assertNull(custTrailing(CustomerKit.Stats()))
        assertNull(custTrailing(null))
        assertEquals("1 sale", custSubtitle(CustFix.customer("c", "A"), CustomerKit.Stats(count = 1)))
    }

    @Test fun theOwedLineSaysItsParts() {
        val owed = CustomerKit.owed(invoices, customers, ledger)
        assertEquals("2 customers · walk-ins PKR 10,000 · typed names PKR 8,000 · hisaab PKR 5,000", custOwedDetail(2, owed, showHisaab = true))
        assertEquals("1 customer · walk-ins PKR 10,000 · typed names PKR 8,000", custOwedDetail(1, owed, showHisaab = false))
    }

    // Repairs

    private fun repair(vararg pieces: Pair<String, Double?>, paid: List<Double> = emptyList(), status: String = "received"): Repair = Repair.fromMap(
        mapOf(
            "id" to "REP-000001", "status" to status, "receivedAt" to "2026-10-01T06:00:00.000Z", "promisedDate" to "2026-10-20",
            "pieces" to pieces.map { mapOf("item" to it.first, "work" to "resize", "price" to it.second) },
            "payments" to paid.map { mapOf("amount" to it, "date" to "2026-10-02T06:00:00.000Z") },
        ),
    )

    @Test fun aRepairsBalanceAndSummary() {
        val r = repair("Gold ring" to 5_000.0, "Bangle" to 2_500.0, "" to 100.0, paid = listOf(1_000.0))
        assertEquals(6_600.0, CustomerKit.repairBalance(r))
        assertEquals("Gold ring + 1 more", CustomerKit.repairSummary(r))
        assertEquals("Repair", CustomerKit.repairSummary(repair()))
        assertEquals("Gold ring", CustomerKit.repairSummary(repair("Gold ring" to null)))
        assertEquals(0.0, CustomerKit.repairBalance(repair("Ring" to 100.0, paid = listOf(500.0))))
        assertTrue(repairSubtitle(r).startsWith("REP-000001 · ") && repairSubtitle(r).contains(" · promised "))
        assertFalse(repairSubtitle(repair("Ring" to 1.0, status = "collected")).contains("promised"))
    }

    @Test fun repairStepsInTheShopsWords() {
        assertEquals("In the shop" to erp.app.ui.Tone.owed, CustomerKit.repairStatus(RepairStatus.received))
        assertEquals("Ready" to erp.app.ui.Tone.settled, CustomerKit.repairStatus(RepairStatus.ready))
        assertEquals("Collected" to erp.app.ui.Tone.quiet, CustomerKit.repairStatus(RepairStatus.collected))
        assertEquals("Cancelled" to erp.app.ui.Tone.quiet, CustomerKit.repairStatus(RepairStatus.cancelled))
        assertEquals("No status" to erp.app.ui.Tone.quiet, CustomerKit.repairStatus(RepairStatus.unknown("")))
        assertEquals("odd" to erp.app.ui.Tone.quiet, CustomerKit.repairStatus(RepairStatus.unknown("odd")))
    }

    @Test fun hisaabRowsReadDebitLessCredit() {
        val owes = CustFix.hisaab("H", "c1", 1_500.0)
        assertEquals("+PKR 1,500", hisaabAmount(owes))
        assertEquals("-PKR 400", hisaabAmount(CustFix.hisaab("H", "c1", 100.0, 500.0)))
        assertNull(hisaabAmount(CustFix.hisaab("H", "c1", 100.0, 100.2)))
        val grams = HisaabEntry.fromMap(mapOf("id" to "H", "entityId" to "c1", "entityType" to "customer", "date" to "2026-09-01T00:00:00.000Z", "goldDebitGrams" to 3.5, "goldCreditGrams" to 1.25, "linkedInvoiceId" to "INV-9"))
        assertTrue(hisaabSubtitle(grams, "silver").endsWith("gave 3.5 g silver · got 1.25 g silver · invoice INV-9"))
    }
}
