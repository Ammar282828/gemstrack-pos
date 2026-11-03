package erp.app.screens.businesses

import erp.app.config.Business
import erp.app.screens.businesses.BandLogic.SignIn
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BandLogicTests {
    private fun biz(id: String, accent: String = "#1F5A4B", onAccent: String = "#FFFFFF") = Business.decode(
        """{"version":1,"id":"$id","name":"$id","shortName":"$id","serverURL":"https://erp.$id.test","metal":"silver",
        "margin":{"kind":"percent","percent":40},
        "palette":{"light":{"accent":"#000000","ground":"#FFFFFF","card":"#FFFFFF","onAccent":"#FFFFFF"},"dark":{"accent":"$accent","ground":"#0F1A16","card":"#17251F","onAccent":"$onAccent"}},
        "logo":{"aspect":4}}""",
    )!!

    @Test fun builtInsKeepTheirOwnColours() {
        assertEquals(BandLogic.Identity("0B1414", "D3B47F", true), BandLogic.identity(biz("taheri")))
        assertEquals(BandLogic.Identity("F2E9E4", "380000", false), BandLogic.identity(biz("mina")))
    }

    @Test fun addedBusinessWearsItsDarkAccent() {
        assertEquals(BandLogic.Identity("1F5A4B", "FFFFFF", true), BandLogic.identity(biz("other")))
        assertEquals(false, BandLogic.identity(biz("light", accent = "#F5F5F5", onAccent = "#111111")).isDark)
    }

    @Test fun cardsSitSideBySideFromSixHundredDp() {
        assertEquals(false, BandLogic.sideBySide(411f))
        assertEquals(false, BandLogic.sideBySide(599.9f))
        assertEquals(true, BandLogic.sideBySide(600f))
        assertEquals(true, BandLogic.sideBySide(1280f))
    }

    @Test fun lastUsedComesFirstRestKeepOrder() {
        val l = listOf(biz("a"), biz("b"), biz("c"))
        assertEquals(listOf("b", "a", "c"), BandLogic.ordered(l, "b").map { it.id })
    }

    @Test fun captionIsEmailThenSignInThenHost() {
        val b = biz("x")
        assertEquals("a@b.test", BandLogic.caption(b, BandLogic.signIn(true, "a@b.test")))
        assertEquals("Sign in", BandLogic.caption(b, BandLogic.signIn(true, null)))
        assertEquals("erp.x.test", BandLogic.caption(b, BandLogic.signIn(false, null)))
    }

    @Test fun lastOpenedWords() {
        val now = Instant.parse("2026-10-30T12:00:00Z")
        fun ago(sec: Long) = now.minusSeconds(sec).toEpochMilli()
        assertNull(BandLogic.lastOpened(null, now))
        assertEquals("Opened just now", BandLogic.lastOpened(ago(30), now))
        assertEquals("Opened 5 min ago", BandLogic.lastOpened(ago(300), now))
        assertEquals("Opened 3 hr ago", BandLogic.lastOpened(ago(3 * 3600), now))
        assertEquals("Opened 1 day ago", BandLogic.lastOpened(ago(24 * 3600), now))
        assertEquals("Opened 2 days ago", BandLogic.lastOpened(ago(48 * 3600), now))
    }

    @Test fun statusJoinsWhatTheScreenReaderNeeds() {
        val b = biz("x")
        val now = Instant.parse("2026-10-30T12:00:00Z")
        assertEquals("Last opened, a@b.test, Opened 5 min ago", BandLogic.status(b, true, SignIn.Email("a@b.test"), now.minusSeconds(300).toEpochMilli(), now))
        assertEquals("Sign in", BandLogic.status(b, false, SignIn.Needed, 1L, now))
    }
}
