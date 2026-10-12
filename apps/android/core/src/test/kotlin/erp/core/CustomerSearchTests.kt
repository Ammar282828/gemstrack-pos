package erp.core

import erp.core.logic.CustomerSearch
import erp.core.logic.pakistanE164
import erp.core.models.Customer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** The names and numbers are made up. */
class CustomerSearchTests {
    private fun customer(id: String, name: String, phone: String? = null, alt: String? = null, removed: Boolean = false): Customer {
        val fields = mutableMapOf<String, Any?>("id" to id, "name" to name)
        if (phone != null) fields["phone"] = phone
        if (alt != null) fields["altPhone"] = alt
        if (removed) fields["deletedAt"] = "2026-10-01T00:00:00.000Z"
        return ERPDecode.model<Customer>(fields)!!
    }

    private val book: List<Customer> by lazy {
        listOf(
            customer("a", "Sana Demo", "+923000000101"),
            customer("b", "Sanaullah Example", "03001112222"),
            customer("c", "Hasan Sample", "923211234567"),
            customer("d", "Ayesha Sana Test", null, alt = "0333 4445556"),
            customer("e", "Sana", "03009998887"),
            customer("f", "Sana Removed", "03000000999", removed = true),
            customer("g", "Walk-in Customer", "03000000111"),
            customer("h", "Zoë Placeholder"),
        )
    }

    private fun ids(q: String, limit: Int = 6): List<String> = CustomerSearch.rank(q, book, limit).map { it.customer.id }

    @Test
    fun testTheWholeNameFirstThenNamesThatBeginWithItThenWordsThatDo() {
        assertEquals(listOf("e", "a", "b", "d"), ids("sana"))
        assertEquals(listOf("e", "a", "b", "d"), ids("  SANA  "))
    }

    @Test
    fun testAWordAnywhereInTheName() {
        assertEquals(listOf("a"), ids("dem"))
        assertEquals(listOf("d"), ids("test"))
    }

    @Test
    fun testEveryTypedWordStartingAWord() {
        assertEquals(listOf("a"), ids("sa de"))
        assertEquals(listOf("d"), ids("ay te"))
    }

    @Test
    fun testLettersInsideAWordComeLast() {
        // "asan" is inside Hasan only.
        assertEquals(listOf("c"), ids("asan"))
    }

    @Test
    fun testANumberHoweverItIsWritten() {
        assertEquals(listOf("b"), ids("0300 111"))
        assertEquals(listOf("c"), ids("+92 321 123"))
        assertEquals(listOf("c"), ids("1234567"))
        // The spare number counts.
        assertEquals(listOf("d"), ids("0333444"))
        assertTrue(CustomerSearch.rank("0333444", book).first().byPhone)
        // Too few digits to mean anything.
        assertEquals(emptyList(), ids("03"))
    }

    @Test
    fun testRemovedAndWalkInRecordsAreNeverOffered() {
        assertFalse(ids("sana").contains("f"))
        assertEquals(emptyList(), ids("walk"))
        assertEquals(emptyList(), ids("03000000111"))
    }

    @Test
    fun testAccentsAndTheLimit() {
        assertEquals(listOf("h"), ids("zoe"))
        assertEquals(listOf("e", "a"), ids("sana", limit = 2))
        assertEquals(emptyList(), ids(""))
    }

    @Test
    fun testTheMatchIsMarkedInTheName() {
        val hit = CustomerSearch.rank("demo", book).first()
        val match = assertNotNull(hit.match)
        assertEquals("Demo", hit.customer.name.substring(match.start, match.end))
    }

    @Test
    fun testAnExactNameIsFoundWhateverTheSpacing() {
        assertEquals(listOf("a"), CustomerSearch.exact("sana   demo", book).map { it.id })
        assertEquals(emptyList(), CustomerSearch.exact("sana d", book))
    }
}

/** phone-field.tsx's toE164 and fromPasted, for the shapes the counter types. Made-up numbers. */
class PakistanE164Tests {
    @Test
    fun testEveryLocalShapeBecomesPlusNinetyTwo() {
        for (typed in listOf(
            "0300 0000101", "03000000101", "923000000101", "+92 300 0000101", "+92 0300 0000101",
            "0092 300 0000101", "3000000101", "+92+92 3000000101", "(0300) 000-0101",
        )) {
            assertEquals("+923000000101", pakistanE164(typed), typed)
        }
    }

    @Test
    fun testAForeignNumberAndOneStillBeingTypedAreLeftAlone() {
        assertEquals("+442079460000", pakistanE164("+44 20 7946 0000"))
        assertEquals("030012", pakistanE164("0300 12"))
        assertEquals("", pakistanE164("  "))
    }
}
