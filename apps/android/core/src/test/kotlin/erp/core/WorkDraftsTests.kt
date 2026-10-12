package erp.core

import erp.core.logic.WorkDraft
import erp.core.logic.draftHref
import erp.core.logic.draftList
import erp.core.logic.draftOrderDetail
import erp.core.logic.draftSaleDetail
import erp.core.logic.draftTitle
import erp.core.logic.isDraftExpired
import erp.core.logic.isDraftId
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/work-drafts.test.ts, the reading side: cards, links, age and ids. */
class WorkDraftsTests {
    private fun draft(id: String, kind: String = "order", updatedAt: String = "2026-09-27T10:00:00Z") = WorkDraft(
        id = id, kind = kind, title = "Sana Ali", detail = "Ruby ring", items = 1, total = 380_000.0, device = "iPhone",
        createdAt = "2026-09-27T09:00:00Z", updatedAt = updatedAt,
    )

    @Test
    fun testACardReadsFromTheDocumentWhateverTheFormHolds() {
        // `data` (the form, photos and all) is not decoded; numbers that arrived as text still read.
        val doc: Map<String, Any?> = mapOf(
            "kind" to "order", "title" to "Sana Ali", "detail" to "Ruby ring, Bangles +1 · advance PKR 25,000",
            "items" to "3", "total" to "380000", "device" to "iPhone", "createdAt" to "2026-09-27T09:00:00Z",
            "updatedAt" to "2026-09-27T10:00:00Z", "leftOut" to listOf("photos"),
            "data" to mapOf("items" to listOf(mapOf("sampleImageDataUri" to "data:image/jpeg;base64,AAAA"))),
        )
        val d = DocJSON.decode<WorkDraft>("order-lq3x9k2a-ab12c", doc)
        assertEquals("order-lq3x9k2a-ab12c", d.id)
        assertTrue(d.isOrder)
        assertFalse(d.isSale)
        assertEquals(3, d.items)
        assertEquals(380_000.0, d.total)
        assertEquals(listOf("photos"), d.leftOut)
        assertEquals("iPhone", d.device)
    }

    @Test
    fun testAnOddDocumentStillReads() {
        val d = DocJSON.decode<WorkDraft>("sale-aaaaaa-b", mapOf("kind" to "sale"))
        assertTrue(d.isSale)
        assertEquals("", d.title)
        assertEquals(0, d.items)
        assertEquals(emptyList(), d.leftOut)
        // No `updatedAt` means it never said when it was typed: forgotten.
        assertTrue(isDraftExpired(d, now = Instant.now()))
    }

    @Test
    fun testIdsLinksAndAge() {
        assertEquals("/orders/add?draft=order-1", draftHref(kind = "order", id = "order-1"))
        assertEquals("/invoices/new?draft=sale-1", draftHref(kind = "sale", id = "sale-1"))
        // encodeURIComponent leaves ! ~ * ' ( ) alone and escapes the rest.
        assertEquals("/orders/add?draft=a%20b%26c%2Fd", draftHref(kind = "order", id = "a b&c/d"))
        val now = ERPDate.parse("2026-09-27T12:00:00Z")!!
        assertFalse(isDraftExpired(draft("order-aaaaaa-b", updatedAt = "2026-09-20T12:00:00Z"), now = now))
        assertTrue(isDraftExpired(draft("order-aaaaaa-b", updatedAt = "2026-08-20T12:00:00Z"), now = now))
        assertTrue(isDraftExpired(draft("order-aaaaaa-b", updatedAt = ""), now = now))
        // Exactly thirty days is still in hand; a second more is not.
        assertFalse(isDraftExpired(draft("order-aaaaaa-b", updatedAt = "2026-08-28T12:00:00Z"), now = now))
        assertTrue(isDraftExpired(draft("order-aaaaaa-b", updatedAt = "2026-08-28T11:59:59Z"), now = now))
    }

    @Test
    fun testAValidDraftId() {
        // newDraftId: "<kind>-<ms in base 36>-<five letters>".
        assertTrue(isDraftId("order-lq3x9k2a-ab12c"))
        assertTrue(isDraftId("sale-m1abcd-z"))
        assertFalse(isDraftId("order-1"))
        assertFalse(isDraftId("invoice-abcdef-ab"))
        assertFalse(isDraftId("order-ABCDEF-ab"))
        assertFalse(isDraftId("order-abcde-ab"))
        assertFalse(isDraftId("order-abcdef-abcdefghi"))
        assertFalse(isDraftId("order-abcdef-"))
        assertFalse(isDraftId("order-abc def-ab"))
    }

    @Test
    fun testTheListIsNewestTypedFirstWithTheExpiredApart() {
        val now = ERPDate.parse("2026-09-27T12:00:00Z")!!
        val older = draft("order-aaaaaa-a", updatedAt = "2026-09-25T10:00:00Z")
        val newer = draft("sale-bbbbbb-b", "sale", updatedAt = "2026-09-27T10:00:00Z")
        val gone = draft("order-cccccc-c", updatedAt = "2026-07-01T10:00:00Z")
        val out = draftList(listOf(older, gone, newer), now = now)
        assertEquals(listOf("sale-bbbbbb-b", "order-aaaaaa-a"), out.live.map { it.id })
        assertEquals(listOf("order-cccccc-c"), out.expired.map { it.id })
    }

    @Test
    fun testAnOrderCardReadsByPiecesAndAdvance() {
        assertEquals(
            "Ruby ring, Bangles +1 · advance PKR 25,000",
            draftOrderDetail(names = listOf("Ruby ring", "Bangles", "Chain"), pieces = 3, advance = 25_000.0),
        )
        assertEquals("Ruby ring", draftOrderDetail(names = listOf("Ruby ring"), pieces = 1, advance = 0.0))
        assertEquals("2 pieces", draftOrderDetail(names = emptyList(), pieces = 2, advance = 0.0))
        assertEquals("1 piece", draftOrderDetail(names = emptyList(), pieces = 1, advance = 0.0))
        assertEquals("No pieces yet", draftOrderDetail(names = emptyList(), pieces = 0, advance = 0.0))
    }

    @Test
    fun testASaleCardReadsByTheCartAndTheDiscount() {
        assertEquals("Gents ring, B-3", draftSaleDetail(names = listOf("Gents ring", "B-3"), discount = 0.0))
        assertEquals("A, B +2 · discount PKR 5,000", draftSaleDetail(names = listOf("A", "B", "C", "D"), discount = 5_000.0))
        assertEquals("No pieces yet", draftSaleDetail(names = emptyList(), discount = 0.0))
    }

    @Test
    fun testTheTitleIsWhoItIsFor() {
        assertEquals("Sana Ali", draftTitle(customer = "  Sana Ali "))
        assertEquals("No customer yet", draftTitle(customer = "   "))
    }
}
