package erp.core

import erp.core.models.Customer
import erp.core.models.Order
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DocJSONTests {
    @Test
    fun testServerTimestampsBecomeISO() {
        val doc: Map<String, Any?> = mapOf(
            "id" to "ORD-000001",
            "createdAt" to mapOf("_seconds" to 1_791_446_400, "_nanoseconds" to 500_000_000),
            "status" to "Pending",
            "grandTotal" to 12_500,
        )
        val orders = DocJSON.decodeList<Order>(listOf(doc))
        assertEquals(1, orders.size)
        assertEquals(ERPDate.iso(ERPDate.fromSeconds(1_791_446_400.5)), orders[0].createdAt)
        assertEquals(12_500.0, orders[0].grandTotal)
    }

    @Test
    fun testDocumentIdWinsAndOddValuesDrop() {
        val data: Map<String, Any?> = mapOf(
            "id" to "stale",
            "name" to "Demo Customer",
            "when" to Instant.ofEpochSecond(0),
            "blob" to byteArrayOf(1, 2, 3),
            "bad" to Double.NaN,
            "flag" to true,
            "nested" to listOf(mapOf("seconds" to 10, "nanoseconds" to 0)),
        )
        @Suppress("UNCHECKED_CAST")
        val plain = assertNotNull(DocJSON.plain(data) as? Map<String, Any?>)
        assertEquals("1970-01-01T00:00:00.000Z", plain["when"])
        assertEquals("AQID", plain["blob"])
        assertNull(plain["bad"])
        assertEquals("1970-01-01T00:00:10.000Z", (plain["nested"] as? List<*>)?.firstOrNull())
        assertTrue(ERPDecode.isValidJsonObject(plain))

        val c = assertNotNull(DocJSON.decode<Customer>("CUST-1", data))
        assertEquals("CUST-1", c.id)
        assertEquals("Demo Customer", c.name)
    }

    @Test
    fun testCustomHookTurnsSDKObjectsIntoText() {
        class Ref(val path: String)
        @Suppress("UNCHECKED_CAST")
        val plain = DocJSON.plain(mapOf("ref" to Ref("customers/CUST-1"))) { (it as? Ref)?.path } as? Map<String, Any?>
        assertEquals("customers/CUST-1", plain?.get("ref"))
    }
}
