package erp.core

import erp.core.logic.Money
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/** lacCrore as src/lib/money.ts documents it, and the lenient reading every model relies on. */
class MoneyTests {
    @Test
    fun testLacCrore() {
        assertEquals("85,000", Money.lacCrore(85_000.0))
        assertEquals("4.5 lac", Money.lacCrore(450_000.0))
        assertEquals("1.25 crore", Money.lacCrore(12_500_000.0))
        assertEquals("1 crore", Money.lacCrore(9_999_999.0))
        assertEquals("-2.5 lac", Money.lacCrore(-250_000.0))
        assertEquals("0", Money.lacCrore(Double.NaN))
    }

    @Test
    fun testLenientDecoding() {
        val json = """{"total":"25,000","name":123,"items":{"1":"b","0":"a"},"paid":"yes"}"""
        @Suppress("UNCHECKED_CAST")
        val c = Container(Json.parse(json) as Map<String, Any?>)
        assertEquals(25_000.0, c.double("total"))
        assertEquals("123", c.string("name"))
        assertEquals(listOf("a", "b"), c.strings("items"))
        assertEquals(true, c.bool("paid"))
    }

    @Test
    fun testDates() {
        assertEquals("2026-10-09", ERPDate.karachiDay(ERPDate.parse("2026-10-08T20:00:00Z")!!))
        assertEquals("2026-10-08", ERPDate.karachiDay(ERPDate.parse("2026-10-08T18:59:59.000Z")!!))
        assertNotNull(ERPDate.parse("2026-10-08"))
        assertNull(ERPDate.parse("soon"))
    }
}
