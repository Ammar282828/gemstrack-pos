package erp.core

import erp.core.logic.Album
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** src/lib/social/album.ts, case for case (AlbumTests.swift). */
class AlbumTests {
    @Test
    fun theCaptionIsUnderTheFirstPhotoOnly() {
        assertEquals(listOf("Ruby ring", "", ""), Album.captions("Ruby ring", 3))
        assertEquals(listOf("Ruby ring"), Album.captions("Ruby ring", 1))
        assertEquals(emptyList(), Album.captions("x", 0))
    }

    @Test
    fun fileNamesFollowTheQueue() {
        assertEquals("ruby-ring.jpg", Album.fileName("ruby-ring", 0))
        assertEquals("ruby-ring-3.jpg", Album.fileName("ruby-ring", 2))
        assertEquals("piece.jpg", Album.fileName("", 0))
    }

    @Test
    fun aCarouselTakesTheFirstTen() {
        assertFalse(Album.carouselPlan(1).carousel)
        assertEquals(0, Album.carouselPlan(10).dropped)
        val many = Album.carouselPlan(13)
        assertEquals(10, many.take)
        assertEquals(3, many.dropped)
        assertTrue(many.carousel)
    }

    @Test
    fun instagramTakesWhatsAppsMarkersOff() {
        assertEquals("Ruby ring in 18k gold was 9 now", Album.instagramText("*Ruby ring* in _18k_ gold ~was 9~ now"))
        assertEquals("a*b*c snake_case_name \nBold line", Album.instagramText("  a*b*c snake_case_name \n*Bold* line\n"))
        assertEquals("https://taheri.shop/a_b_c (new)!", Album.instagramText("https://taheri.shop/a_b_c (*new*)!"))
    }

    @Test
    fun aPlaceThatFailedAPhotoGetsNoMore() {
        assertEquals(listOf("a", "channel"), Album.placesFor(listOf("a", "b", "channel"), setOf("b")))
        assertEquals(emptyList(), Album.placesFor(listOf("a"), setOf("a")))
        assertEquals("1 photo", Album.photosLabel(1))
        assertEquals("3 photos", Album.photosLabel(3))
    }
}
