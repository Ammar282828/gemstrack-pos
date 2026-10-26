package erp.app.screens.marketing

import erp.app.data.ErpApi
import java.io.File
import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** PostsStore.swift's kept list: painted at once, refreshed behind it, kept (with its time) when the site blips. Made-up pieces only. */
class SitePiecesKeepTests {
    private lateinit var dir: File

    private fun answer(vararg ids: String) =
        """{"site":"https://example.shop","pieces":[${ids.joinToString(",") { """{"id":"$it","name":"Piece $it"}""" }}],"posted":{}}"""

    @Before fun setUp() {
        dir = Files.createTempDirectory("sitepieces").toFile()
        PostsStore.piecesDir = { dir }
        PostsStore.businessId = { "taheri" }
        PostsStore.resetForTest()
    }

    @After fun tearDown() { dir.deleteRecursively() }

    private fun load(fetch: suspend () -> String) = runBlocking { PostsStore.fetchPieces = fetch; PostsStore.loadPieces() }

    @Test fun theLeanListWithFortyFiveSecondsIsWhatIsAsked() {
        assertEquals("/api/website/site-pieces?lean=1", SitePiecesKeep.PATH)
        assertEquals(45_000L, SitePiecesKeep.TIMEOUT_MS)
    }

    @Test fun aReadIsKeptPerBusinessAndNothingIsShownFromWhenItWorked() {
        load { answer("a", "b") }
        val s = PostsStore.state.value
        assertEquals(listOf("a", "b"), s.pieces.map { it.id })
        assertNull(s.shownFrom)
        assertNotNull(SitePiecesKeep.kept(dir, "taheri"))
        assertNull(SitePiecesKeep.kept(dir, "mina"))
    }

    @Test fun aBlipWithAKeptListPaintsItWithItsTime() {
        SitePiecesKeep.keep(dir, "taheri", answer("k1"))
        load { throw java.io.IOException("offline") }
        val s = PostsStore.state.value
        assertEquals(listOf("k1"), s.pieces.map { it.id })
        assertEquals(PostsPhase.Loaded, s.piecesPhase)
        assertNotNull(s.shownFrom)
    }

    @Test fun aBlipAfterAGoodReadKeepsTheListOnScreenAndSaysSo() {
        load { answer("a") }
        load { throw ErpApi.Failure(502, "the site did not answer") }
        val s = PostsStore.state.value
        assertEquals(listOf("a"), s.pieces.map { it.id })
        assertNotNull(s.shownFrom)
        // and the next good read lets go of it
        load { answer("a", "c") }
        assertNull(PostsStore.state.value.shownFrom)
        assertEquals(2, PostsStore.state.value.pieces.size)
    }

    @Test fun nothingKeptAndNoAnswerIsAFailureTheScreenShows() {
        load { throw ErpApi.Failure(502, "the site did not answer") }
        val phase = PostsStore.state.value.piecesPhase
        assertTrue(phase is PostsPhase.Failed && phase.message == "the site did not answer")
    }

    @Test fun a404MeansThisSitePublishesNoList() {
        SitePiecesKeep.keep(dir, "taheri", answer("k1"))
        load { throw ErpApi.Failure(404, "none") }
        assertEquals(PostsPhase.Off, PostsStore.state.value.piecesPhase)
    }

    @Test fun anUnreadableAnswerIsSaidInPlainWords() {
        load { "[1,2]" }
        val phase = PostsStore.state.value.piecesPhase
        assertTrue(phase is PostsPhase.Failed && phase.message.startsWith("The website's pieces came back in a shape"))
    }
}
