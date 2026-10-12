package erp.app

import erp.app.data.Delivery
import erp.app.data.Demo
import erp.app.data.ServerShelf
import erp.app.data.Shelf
import erp.app.data.Single
import erp.app.data.Sort
import erp.app.data.WorkDraftSync
import erp.core.ERPDate
import erp.core.Registry
import erp.core.models.Customer
import erp.core.models.Order
import erp.core.models.Settings
import java.time.Instant
import kotlin.random.Random
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BookTests {
    private fun orderShelf() = Shelf(
        "orders", Registry.decoder(Order::class), { it.id }, Sort.descending { it.createdAt }, book = null,
    )

    private fun order(id: String, createdAt: String): Order = Order.from(id, mapOf("createdAt" to createdAt, "status" to "Pending"))

    @Test fun aFirstAnswerIsTheShelfSortedNewestFirst() {
        val s = orderShelf()
        assertFalse(s.loaded.value)
        s.take(Delivery.All(listOf(order("A", "2026-10-01T00:00:00.000Z"), order("C", "2026-10-03T00:00:00.000Z"), order("B", "2026-10-02T00:00:00.000Z")), offline = false))
        assertEquals(listOf("C", "B", "A"), s.items.value.map { it.id })
        assertTrue(s.loaded.value)
        assertEquals("B", s.item("B")?.id)
        assertNull(s.item("Z"))
    }

    @Test fun anEmptyCollectionIsStillAnAnswer() {
        val s = orderShelf()
        s.take(Delivery.All(emptyList(), offline = false))
        assertTrue(s.loaded.value)
        assertTrue(s.items.value.isEmpty())
    }

    @Test fun aHandfulOfChangesIsPlacedWhereItSortsNotSortedAgain() {
        val s = orderShelf()
        s.take(Delivery.All(listOf(order("A", "2026-10-01T00:00:00.000Z"), order("C", "2026-10-03T00:00:00.000Z")), offline = false))
        val rev = s.revision.value
        s.take(Delivery.Changes(listOf(order("B", "2026-10-02T00:00:00.000Z")), emptyList(), offline = false))
        assertEquals(listOf("C", "B", "A"), s.items.value.map { it.id })
        assertTrue(s.revision.value > rev)
        // an edited one moves to its new place and is not doubled
        s.take(Delivery.Changes(listOf(order("A", "2026-10-09T00:00:00.000Z")), emptyList(), offline = false))
        assertEquals(listOf("A", "C", "B"), s.items.value.map { it.id })
        s.take(Delivery.Changes(emptyList(), listOf("C"), offline = false))
        assertEquals(listOf("A", "B"), s.items.value.map { it.id })
        assertNull(s.item("C"))
    }

    @Test fun manyChangesAtOnceRebuildTheWholeShelf() {
        val s = orderShelf()
        s.take(Delivery.All(listOf(order("A", "2026-10-01T00:00:00.000Z")), offline = false))
        val many = (1..40).map { order("N$it", "2026-11-%02dT00:00:00.000Z".format(it.coerceAtMost(28))) }
        s.take(Delivery.Changes(many, emptyList(), offline = false))
        assertEquals(41, s.items.value.size)
        assertEquals("A", s.items.value.last().id)
    }

    @Test fun onlyTheCacheFlagMovingChangesNothingOfTheBooks() {
        val s = orderShelf()
        s.take(Delivery.All(listOf(order("A", "2026-10-01T00:00:00.000Z")), offline = true))
        assertTrue(s.offline.value)
        val rev = s.revision.value
        val items = s.items.value
        s.take(Delivery.Changes(emptyList(), emptyList(), offline = false))
        assertFalse(s.offline.value)
        assertEquals(rev, s.revision.value)
        assertTrue(items === s.items.value)
    }

    @Test fun aFailureKeepsWhatIsOnScreen() {
        val s = orderShelf()
        s.take(Delivery.All(listOf(order("A", "2026-10-01T00:00:00.000Z")), offline = false))
        s.take(Delivery.Failed("No connection"))
        assertEquals("No connection", s.error.value)
        assertEquals(1, s.items.value.size)
        s.take(Delivery.All(listOf(order("A", "2026-10-01T00:00:00.000Z")), offline = false))
        assertNull(s.error.value)
    }

    @Test fun resetEmptiesTheShelfForTheNextPerson() {
        val s = orderShelf()
        s.take(Delivery.All(listOf(order("A", "2026-10-01T00:00:00.000Z")), offline = true))
        s.reset()
        assertTrue(s.items.value.isEmpty())
        assertFalse(s.loaded.value)
        assertFalse(s.offline.value)
        assertNull(s.item("A"))
    }

    @Test fun theSettingsDocumentIsOneValue() {
        val one = Single("app_settings", "global", Registry.decoder(Settings::class))
        assertNull(one.value.value)
        one.take(Delivery.All(listOf(Settings.from("global", mapOf("theme" to "default"))), offline = false))
        assertEquals("default", one.value.value?.theme)
        // an answer with nothing in it keeps what was there
        one.take(Delivery.All(emptyList(), offline = false))
        assertEquals("default", one.value.value?.theme)
        one.reset()
        assertNull(one.value.value)
    }

    @Test fun serverShelfReadsDocsWithTheAdminSdksTimestamps() {
        val text = """{"docs":[
            {"id":"ORD-2","createdAt":{"_seconds":1790000000,"_nanoseconds":0},"status":"Pending"},
            {"id":"ORD-1","createdAt":"2026-10-01T10:00:00.000Z","status":"Pending"},
            "not a document"]}"""
        val got = ServerShelf.decode(Registry.decoder(Order::class), text, single = false)
        assertEquals(listOf("ORD-2", "ORD-1"), got.map { it.id })
        assertEquals(ERPDate.iso(Instant.ofEpochSecond(1790000000)), got.first().createdAt)
    }

    @Test fun serverShelfReadsTheSettingsDocAndToleratesAnythingElse() {
        val one = ServerShelf.decode(Registry.decoder(Settings::class), """{"doc":{"id":"global","theme":"slate"}}""", single = true)
        assertEquals("slate", one.single().theme)
        assertEquals(1, ServerShelf.decode(Registry.decoder(Settings::class), "{}", single = true).size)
        assertTrue(ServerShelf.decode(Registry.decoder(Order::class), "<html>", single = false).isEmpty())
        assertTrue(ServerShelf.decode(Registry.decoder(Order::class), """{"docs":"x"}""", single = false).isEmpty())
    }

    @Test fun skusAndNamesSortAsPeopleExpect() {
        assertTrue(Sort.standardCompare("SKU-2", "SKU-10") < 0, "digits are numbers")
        assertTrue(Sort.standardCompare("sku-2", "SKU-2") == 0, "case is ignored")
        assertTrue(Sort.standardCompare("A9", "A10") < 0)
        assertTrue(Sort.standardCompare("A", "A1") < 0)
        val byName = Sort.byName<Customer> { it.name }
        val a = Customer.from("1", mapOf("name" to "amna"))
        val b = Customer.from("2", mapOf("name" to "Bilal"))
        assertTrue(byName.compare(a, b) < 0, "amna before Bilal")
    }

    @Test fun theDemoMakesItsRelativeDatesReal() {
        // 2026-10-12 12:00 Karachi = 07:00Z
        val now = Instant.parse("2026-10-12T07:00:00Z")
        assertEquals("2026-10-10T09:30:00.000Z", Demo.when_("@d-2 14:30", now))
        assertEquals("2026-10-17", Demo.when_("@day+5", now))
        assertEquals("2026-10-12", Demo.when_("@day0", now))
        assertEquals("2026-10-11", Demo.when_("@day-1", now))
        assertNull(Demo.when_("plain", now))
        assertNull(Demo.when_("@dx 14:30", now))
        // Karachi's midnight is the day before in UTC
        assertEquals("2026-10-11T19:00:00.000Z", Demo.when_("@d0 00:00", now))
        val docs = Demo.parse("""{"orders":[{"id":"O1","when":"@d-1 10:00","lines":["@day+2","x"]}],"customers":"no"}""", now)
        assertEquals(listOf("orders"), docs.keys.toList())
        assertEquals("2026-10-11T05:00:00.000Z", docs.getValue("orders").single()["when"])
        assertEquals(listOf("2026-10-14", "x"), docs.getValue("orders").single()["lines"])
    }

    @Test fun aDraftIdIsTheWebsKind_ms36_fiveLetters() {
        val id = WorkDraftSync.newId("order", nowMs = 1_790_000_000_000, random = Random(1))
        assertTrue(Regex("order-[0-9a-z]+-[0-9a-z]{5}").matches(id), id)
        assertEquals(1_790_000_000_000L.toString(36), id.split('-')[1])
        assertEquals("sale-0-", WorkDraftSync.newId("sale", nowMs = -5).substring(0, 7))
    }
}
