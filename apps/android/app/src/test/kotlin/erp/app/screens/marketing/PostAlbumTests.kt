package erp.app.screens.marketing

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A post's card starts with the hero photo alone and the piece's others are offered (PostTrayPhotos.swift). */
class PostAlbumTests {
    private fun piece(photos: Int) = PostPiece.from(
        mapOf(
            "id" to "Rings/R-101.webp", "name" to "Solitaire ring", "image" to "https://example.test/a.jpg",
            "photos" to (2..photos + 1).map { mapOf("key" to "k$it", "image" to "https://example.test/$it.jpg") } + listOf(mapOf("key" to "none", "image" to "")),
        ),
    )!!

    @Test
    fun aCardStartsWithTheHeroAlone() {
        val card = PostTrayCard(piece(3))
        assertEquals(1, card.album.size)
        assertTrue(card.album[0].isLead)
        assertEquals("The photo as it is on the website", card.going)
    }

    @Test
    fun theOthersAreTheOwnPhotosWithAnAddressAndComeInByNumber() {
        val p = piece(3)
        // The empty one is dropped; the n-th photo is `photo=n` from 2.
        assertEquals(3, p.photos.size)
        val card = PostTrayCard(p)
        card.album.add(PostAlbumPhoto.own(p, 0))
        card.album.add(PostAlbumPhoto.own(p, 2))
        assertEquals(listOf("lead", "angle-2", "angle-4"), card.album.map { it.id })
        assertEquals(2, (card.album[1].kind as PostAlbumPhoto.Kind.Angle).n)
        assertEquals("The photo as it is on the website, then 2 more (3 photos in all)", card.going)
    }

    @Test
    fun aPieceWithNoOtherPhotosOffersNone() {
        assertTrue(piece(0).photos.isEmpty())
        assertNull(PostTrayCard(piece(0)).album.firstOrNull { !it.isLead })
    }
}
