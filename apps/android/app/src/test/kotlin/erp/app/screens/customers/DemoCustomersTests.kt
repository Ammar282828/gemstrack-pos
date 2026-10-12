package erp.app.screens.customers

import erp.app.data.Demo
import erp.core.ERPDecode
import erp.core.models.Customer
import erp.core.models.GivenItem
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Order
import erp.core.models.Repair
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The Customers screens render from the demo books (CONVENTIONS.md rule 13): what they read of the demo's customers,
// invoices, orders, repairs and hisaab works out for owner and staff, every row has its words, and the merge finder
// runs over the demo's people. (The screens themselves have no screenshot harness yet.)
class DemoCustomersTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private val docs: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }

    private val customers: List<Customer> by lazy { docs.getValue("customers").map { ERPDecode.model<Customer>(it)!! } }
    private val invoices: List<Invoice> by lazy { docs.getValue("invoices").map { ERPDecode.model<Invoice>(it)!! } }
    private val orders: List<Order> by lazy { docs.getValue("orders").map { ERPDecode.model<Order>(it)!! } }
    private val repairs: List<Repair> by lazy { docs.getValue("repairs").map { ERPDecode.model<Repair>(it)!! } }
    private val hisaab: List<HisaabEntry> by lazy { docs.getValue("hisaab").map { ERPDecode.model<HisaabEntry>(it)!! } }
    private val given: List<GivenItem> by lazy { docs.getValue("given_items").map { ERPDecode.model<GivenItem>(it)!! } }

    @Test fun theDemoHasCustomersToShow() {
        assertTrue(customers.size >= 3)
        assertTrue(customers.all { it.id.isNotEmpty() && !CustomerKit.isRemoved(it) })
    }

    @Test fun theListGroupsEveryoneOnceForOwnerAndStaff() {
        for (ledger in listOf(hisaab, null)) {
            val live = customers.filter { !CustomerKit.isRemoved(it) }
            val owed = CustomerKit.owed(invoices, customers, ledger)
            val stats = CustomerKit.stats(invoices, orders, owed)
            val groups = CustomerKit.groups(live, stats, now)
            val ids = (groups.owing + groups.active + groups.quiet).map { it.id }
            assertEquals(live.map { it.id }.sorted(), ids.sorted(), "everyone is in exactly one group")
            assertTrue(groups.owing.all { (stats[it.id]?.owed ?: 0.0) > 0 })
            for (c in live) {
                assertTrue(CustomerKit.shown(c).isNotEmpty())
                custSubtitle(c, stats[c.id])
                custTrailing(stats[c.id])
                CustomerKit.callUri(c.phone)
                CustomerKit.whatsAppUri(c.phone)
                assertTrue(CustomerKit.matches(c, c.name))
            }
            custOwedDetail(groups.owing.size, owed, showHisaab = ledger != null)
            // Staff have no hisaab: nothing of it in their figure.
            if (ledger == null) assertEquals(0.0, owed.ledger)
        }
    }

    @Test fun eachCustomersPageHasItsWords() {
        val owed = CustomerKit.owed(invoices, customers, hisaab)
        for (c in customers) {
            val o = CustomerKit.owing(c.id, owed, hisaab)
            owedDetail(o)
            assertTrue(CustomerKit.path(c.id).startsWith("/customers/"))
            assertEquals(c.id, CustomerKit.id(CustomerKit.path(c.id)))
            assertEquals(c.id, CustomerKit.editId(CustomerKit.path(c.id, "/edit")))
            CustomerKit.day(c.birthday)
            CustomerKit.sourceLabel(c.source ?: erp.core.models.CustomerSource.other)
        }
        for (i in invoices) invoiceSubtitle(i)
        for (o in orders) orderSubtitle(o)
        for (r in repairs) {
            repairSubtitle(r)
            CustomerKit.repairSummary(r)
            CustomerKit.repairStatus(r.status)
            assertTrue(CustomerKit.repairBalance(r) >= 0)
        }
        for (h in hisaab) {
            hisaabAmount(h)
            hisaabSubtitle(h, "gold")
        }
    }

    @Test fun theMergeFinderRunsOverTheDemoPeople() {
        val found = CustomerDuplicates.detect(customers.map { CustomerDuplicates.Candidate(it.id, it.name, it.phone ?: "") })
        val ids = customers.map { it.id }.toSet()
        assertTrue(found.all { it.a in ids && it.b in ids && it.a != it.b })
        val book = CustomerMergeBook(invoices, orders, hisaab, given, repairs)
        for (c in customers) {
            val counts = book.counts(c.id)
            assertTrue(counts.total >= 0)
            counts.sentence
        }
        // Every invoice that names a demo customer is counted for that customer.
        assertEquals(invoices.count { it.customerId in ids }, customers.sumOf { book.counts(it.id).invoices })
    }

    @Test fun theNewAndEditFormsWorkOnADemoCustomer() {
        val c = customers.first()
        val d = CustomerDraft.of(c)
        assertTrue(d.patch(c).isEmpty())
        assertEquals(setOf("notes"), d.copy(notes = "made-up note").patch(c).keys)
        assertEquals(c.name, NewCustomerForm(name = c.name).nameToSave)
    }
}
