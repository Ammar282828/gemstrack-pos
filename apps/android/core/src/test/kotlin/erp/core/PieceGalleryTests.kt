package erp.core

import erp.core.entry.NewOrderDraft
import erp.core.entry.NewOrderDraftStore
import erp.core.entry.NewOrderEdit
import erp.core.entry.NewOrderExtraPhoto
import erp.core.entry.NewOrderMath
import erp.core.entry.NewOrderPieceDraft
import erp.core.entry.onFile
import erp.core.logic.KarigarPortalJob
import erp.core.logic.PhotoSource
import erp.core.logic.PieceGallery
import erp.core.models.Order
import erp.core.models.OrderItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A piece's reference photos (lib/order-photos.ts, src/lib/writes/order-photos-many.test.ts, OrderPhotosTests.swift): the first where
 * every older order keeps it, the rest in `extraPhotos`; the payload the form sends; the editor's list rules. Bytes are made up.
 */
class PieceGalleryTests {
    private fun item(extra: Map<String, Any?> = emptyMap()): OrderItem =
        OrderItem.fromMap(mapOf("description" to "Ring", "metalType" to "gold", "samplePhotoId" to "p1") + extra)

    private val rates = NewOrderMath.formRates(NewOrderDraft.fresh(), null)
    private fun bytes(n: Int) = byteArrayOf(n.toByte(), 2, 3)
    private fun uri(n: Int) = "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(bytes(n))

    // MARK: Reading (OrderPhotosTests.swift)

    @Test fun anOlderPieceHasNoExtras() {
        val i = item()
        assertEquals("p1", i.samplePhotoId)
        assertTrue(i.extraPhotos.isEmpty())
        assertEquals(listOf(PhotoSource("p1", storedId = "p1")), PieceGallery.sources(i))
    }

    @Test fun extrasReadInOrderAndOdditiesAreDropped() {
        val i = item(mapOf("extraPhotos" to listOf(mapOf("id" to "p2", "hash" to "h"), mapOf("dataUri" to "data:image/jpeg;base64,AAA"), emptyMap<String, Any?>(), "junk")))
        assertEquals(2, i.extraPhotos.size)
        assertEquals("p2", i.extraPhotos[0].id)
        assertEquals("data:image/jpeg;base64,AAA", i.extraPhotos[1].dataUri)
        val s = PieceGallery.sources(i)
        assertEquals(listOf("p1", "p2"), s.take(2).map { it.id })
        assertEquals("data:image/jpeg;base64,AAA", s[2].uri)
    }

    @Test fun anInlineFirstWinsOverItsId_andAPieceTakesEight() {
        val many = (1..12).map { mapOf("id" to "x$it") }
        val s = PieceGallery.sources(item(mapOf("sampleImageDataUri" to "https://x.test/y.jpg", "extraPhotos" to many)))
        assertEquals(8, s.size)
        assertEquals("https://x.test/y.jpg", s[0].uri)
        assertEquals("x1", s[1].storedId)
    }

    @Test fun karigarJobReadsExtraPictures() {
        val job = KarigarPortalJob.fromMap(mapOf("id" to "order:O:0", "source" to "order", "description" to "Ring", "sampleImage" to "data:a", "extraSampleImages" to listOf("data:b", "data:c")))
        assertEquals(listOf("data:b", "data:c"), job.extraSampleImages)
        assertEquals(listOf("data:a", "data:b", "data:c"), job.sampleImages)
        assertEquals(3, PieceGallery.sources(job.id, job.sampleImages).size)
        assertEquals(emptyList(), KarigarPortalJob.fromMap(mapOf("id" to "job:1")).extraSampleImages)
    }

    // MARK: The payload (NewOrderMath.swift)

    @Test fun newPicturesGoInlineInOrderAndFiledOnesByDocument() {
        val p = NewOrderPieceDraft()
        p.description = "Ring"
        p.photo = bytes(1)
        p.extras = mutableListOf(NewOrderExtraPhoto(storedId = "b"), NewOrderExtraPhoto(data = bytes(2)))
        val o = NewOrderMath.item(p, rates, photo = true)
        assertEquals(uri(1), o["sampleImageDataUri"])
        assertEquals(listOf(mapOf("id" to "b"), mapOf("dataUri" to uri(2))), o["extraPhotos"])
    }

    @Test fun noExtrasSendsNothing_butAnEmptiedListClearsWhatIsOnFile() {
        val p = NewOrderPieceDraft()
        p.description = "Ring"
        assertFalse(NewOrderMath.item(p, rates, photo = true).containsKey("extraPhotos"))
        p.hadExtras = true
        assertEquals(emptyList<Any>(), NewOrderMath.item(p, rates, photo = true)["extraPhotos"])
        // A sale's line carries no photos at all.
        p.extras = mutableListOf(NewOrderExtraPhoto(storedId = "b"))
        assertFalse(NewOrderMath.item(p, rates, photo = false).containsKey("extraPhotos"))
    }

    @Test fun editLoadsTheOrdersExtrasAndTakingThemAllOffSendsAnEmptyList() {
        val order = Order.fromMap(mapOf("id" to "ORD-1", "items" to listOf(
            mapOf("description" to "Ring", "metalType" to "gold", "samplePhotoId" to "a", "extraPhotos" to listOf(mapOf("id" to "b"), mapOf("dataUri" to uri(3)))),
        )))
        val p = NewOrderEdit(order).draft.pieces[0]
        assertEquals(2, p.extras.size)
        assertEquals("b", p.extras[0].storedId)
        assertTrue(p.extras[1].data!!.contentEquals(bytes(3)))
        assertTrue(p.hadExtras)
        // Re-sent as stored: the filed one by id, the inline one inline; the first is left on file.
        val o = NewOrderMath.item(p, rates, photo = true)
        assertNull(o["sampleImageDataUri"])
        assertEquals(listOf(mapOf("id" to "b"), mapOf("dataUri" to uri(3))), o["extraPhotos"])
        p.extras.clear()
        assertEquals(emptyList<Any>(), NewOrderMath.item(p, rates, photo = true)["extraPhotos"])
    }

    // MARK: The editor's list

    @Test fun theFirstFillsTheMainSlotThenTheRestFollowUpToEight() {
        val p = NewOrderPieceDraft()
        val leftOut = PieceGallery.add(p, (1..10).map { bytes(it) })
        assertTrue(leftOut)
        assertTrue(p.photo!!.contentEquals(bytes(1)))
        assertEquals(7, p.extras.size)
        assertEquals(0, PieceGallery.room(p))
        assertEquals(8, PieceGallery.sources(p).size)
        assertFalse(PieceGallery.add(NewOrderPieceDraft(), listOf(bytes(1))))
    }

    @Test fun removingTheMainOneTakesItOffAndRemovingAnExtraDropsOnlyThat() {
        val p = NewOrderPieceDraft()
        p.samplePhotoId = "a"
        p.extras = mutableListOf(NewOrderExtraPhoto(storedId = "b"), NewOrderExtraPhoto(storedId = "c"))
        PieceGallery.remove(p, 1) // "b"
        assertEquals(listOf("c"), p.extras.map { it.storedId })
        PieceGallery.remove(p, 0) // the main one
        assertTrue(p.removePhoto)
        assertEquals(listOf("c"), PieceGallery.sources(p).map { it.id })
        // With the main one gone, a new picture fills its slot.
        PieceGallery.add(p, listOf(bytes(5)))
        assertFalse(p.removePhoto)
        assertEquals(2, PieceGallery.count(p))
    }

    @Test fun extrasMoveEarlierOrLaterButNotPastTheEnds() {
        val p = NewOrderPieceDraft()
        p.extras = mutableListOf(NewOrderExtraPhoto(storedId = "a"), NewOrderExtraPhoto(storedId = "b"), NewOrderExtraPhoto(storedId = "c"))
        PieceGallery.move(p, 2, -1)
        assertEquals(listOf("a", "c", "b"), p.extras.map { it.storedId })
        PieceGallery.move(p, 0, -1)
        PieceGallery.move(p, 2, 1)
        assertEquals(listOf("a", "c", "b"), p.extras.map { it.storedId })
    }

    // MARK: The draft on the phone

    @Test fun theDraftKeepsExtrasAndLeavesTheirBytesOutWhenTooBig() {
        val order = NewOrderDraft.fresh()
        order.customerName = "Test Buyer"
        val p = NewOrderPieceDraft()
        p.description = "Test ring"
        p.extras = mutableListOf(NewOrderExtraPhoto(storedId = "b"), NewOrderExtraPhoto(data = bytes(2)))
        p.hadExtras = true
        order.pieces.add(p)
        val back = NewOrderDraftStore.decode(NewOrderDraftStore.encode(order)!!)!!.pieces[0]
        assertEquals(listOf("b", null), back.extras.map { it.storedId })
        assertTrue(back.extras[1].data!!.contentEquals(bytes(2)))
        assertTrue(back.hadExtras)
        // An empty slot in a saved draft is gone, not kept.
        val odd = NewOrderPieceDraft.fromMap(mapOf("extras" to listOf(mapOf("id" to "not-a-uuid"), mapOf("storedId" to "z"))))
        assertEquals(listOf("z"), odd.extras.map { it.storedId })
    }
}
