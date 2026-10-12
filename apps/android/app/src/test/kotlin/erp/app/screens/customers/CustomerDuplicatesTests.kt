package erp.app.screens.customers

import erp.app.screens.customers.CustomerDuplicates.Candidate
import erp.core.models.GivenItem
import erp.core.models.Repair
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The pairing is src/lib/customer-duplicates.ts line for line; these are its cases. */
class CustomerDuplicatesTests {
    @Test fun namesAreNormalised() {
        assertEquals("sana demo", CustomerDuplicates.normalizeName("  Sana \t DEMO\n"))
        assertEquals("", CustomerDuplicates.normalizeName(null))
        assertEquals("3001234567", CustomerDuplicates.normalizePhone("0300 1234567"))
        assertEquals("923001234567", CustomerDuplicates.normalizePhone("+92 300 1234567"))
        assertEquals("", CustomerDuplicates.normalizePhone("000"))
    }

    @Test fun similarityIsOneNinetyOrTheSharedWords() {
        assertEquals(1.0, CustomerDuplicates.nameSimilarity("Sana Demo", " sana  demo"))
        assertEquals(0.9, CustomerDuplicates.nameSimilarity("Sana", "Sana Demo"))
        assertEquals(0.5, CustomerDuplicates.nameSimilarity("Sana Demo", "Demo Example"))
        assertEquals(0.0, CustomerDuplicates.nameSimilarity("Sana", "Bilal"))
        // A blank name is like nothing (the page read it as inside every name).
        assertEquals(0.0, CustomerDuplicates.nameSimilarity("", "Sana"))
        assertEquals(0.0, CustomerDuplicates.nameSimilarity(null, null))
    }

    @Test fun aSharedNumberOrAnAlmostSameNameIsAPair() {
        val found = CustomerDuplicates.detect(
            listOf(
                Candidate("a", "Sana Demo", "0300 1111111"),
                Candidate("b", "Bilal Example", "0300 1111111"),
                Candidate("c", "sana demo", ""),
                Candidate("d", "Zoya", ""),
                Candidate("e", "Zoya Sample", ""),
                Candidate("f", "Kamran", "0"),
                Candidate("g", "Kamran", "00"),
            ),
        )
        // Best first; equals keep the book's order.
        assertEquals(listOf("a|b", "a|c", "f|g", "d|e"), found.map { it.id })
        val byId = found.associateBy { it.id }
        assertEquals("Same phone number", byId.getValue("a|b").reason)
        assertEquals(1.0, byId.getValue("a|b").score)
        assertEquals("Similar name (100% match)", byId.getValue("a|c").reason)
        assertEquals("Similar name (90% match)", byId.getValue("d|e").reason)
        // Zeros alone are no number, so only the names say Kamran twice.
        assertEquals("Similar name (100% match)", byId.getValue("f|g").reason)
    }

    @Test fun halfTheWordsIsNotEnough() {
        val found = CustomerDuplicates.detect(listOf(Candidate("a", "Sana Demo", ""), Candidate("b", "Demo Example", "")))
        assertTrue(found.isEmpty())
    }

    @Test fun aPairKeysTheSameEitherWayRound() {
        assertEquals(CustomerDuplicates.Found("a", "b", "x", 1.0).id, CustomerDuplicates.Found("b", "a", "x", 1.0).id)
    }

    @Test fun whatAMergeMovesIsSaidInTheKindsThereAre() {
        assertEquals("nothing", CustomerMergeCounts().sentence)
        assertEquals("1 invoice", CustomerMergeCounts(invoices = 1).sentence)
        assertEquals("3 invoices and 1 order", CustomerMergeCounts(invoices = 3, orders = 1).sentence)
        assertEquals(
            "3 invoices, 1 order, 2 repairs, 2 hisaab rows and 1 given item",
            CustomerMergeCounts(invoices = 3, orders = 1, hisaab = 2, given = 1, repairs = 2).sentence,
        )
        assertEquals(9, CustomerMergeCounts(invoices = 3, orders = 1, hisaab = 2, given = 1, repairs = 2).total)
        assertEquals("No invoices, orders, repairs or hisaab to move.", movesWords(CustomerMergeCounts()))
        assertEquals("Moves 2 invoices to the customer kept.", movesWords(CustomerMergeCounts(invoices = 2)))
    }

    @Test fun theBooksAreCountedOnceByCustomer() {
        val invoices = listOf(CustFix.invoice("I1", "a", 1.0, 0.0, "2026-10-01T00:00:00.000Z"), CustFix.invoice("I2", "a", 1.0, 0.0, "2026-10-01T00:00:00.000Z"), CustFix.invoice("I3", null, 1.0, 0.0, "2026-10-01T00:00:00.000Z"))
        val orders = listOf(CustFix.order("O1", "a", 1.0, "2026-10-01T00:00:00.000Z"), CustFix.order("O2", "b", 1.0, "2026-10-01T00:00:00.000Z"))
        // A karigar's row is not a customer's.
        val hisaab = listOf(CustFix.hisaab("H1", "a", 1.0), erp.core.models.HisaabEntry.fromMap(mapOf("id" to "H2", "entityId" to "a", "entityType" to "karigar")))
        val given = listOf(GivenItem.fromMap(mapOf("id" to "G1", "recipientId" to "b", "recipientType" to "customer")))
        val repairs = listOf(Repair.fromMap(mapOf("id" to "R1", "customerId" to "a")))
        val book = CustomerMergeBook(invoices, orders, hisaab, given, repairs)
        assertEquals(CustomerMergeCounts(invoices = 2, orders = 1, hisaab = 1, given = 0, repairs = 1), book.counts("a"))
        assertEquals(CustomerMergeCounts(orders = 1, given = 1), book.counts("b"))
        assertEquals(CustomerMergeCounts(), book.counts("nobody"))
        assertEquals(
            "Moves 2 invoices and 1 order from Zed to Amy.",
            duplicateMoves(CustomerMergeCounts(invoices = 2, orders = 1), CustFix.customer("z", "Zed"), CustFix.customer("y", "Amy")),
        )
        assertEquals(
            "Zed has no invoices, orders, repairs or hisaab to move.",
            duplicateMoves(CustomerMergeCounts(), CustFix.customer("z", "Zed"), CustFix.customer("y", "Amy")),
        )
    }

    @Test fun theManualSearchNeedsTwoLettersAndShowsSix() {
        val live = (1..10).map { CustFix.customer("c$it", "Sana $it", "0300000000$it") } + CustFix.customer("x", "Bilal", "0301")
        assertTrue(mergeMatches(live, "s", "").isEmpty())
        assertEquals(6, mergeMatches(live, "sa", "").size)
        assertEquals(listOf("c2", "c3", "c4", "c5", "c6", "c7"), mergeMatches(live, "sa", "c1").map { it.id }.take(6))
        assertEquals(listOf("x"), mergeMatches(live, "0301", "").map { it.id })
        assertTrue(mergeMatches(live, "zzz", "").isEmpty())
    }
}
