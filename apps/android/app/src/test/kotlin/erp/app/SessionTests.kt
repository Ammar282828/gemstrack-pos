package erp.app

import erp.app.auth.Jwt
import erp.app.auth.Me
import erp.app.auth.Session
import erp.app.auth.Shop
import erp.app.nav.ThemeChoice
import java.util.Base64
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SessionTests {
    private val answer = """{"email":"owner@example.com","role":"owner","shop":{"name":"TAHERI","person":"Demo","takenBy":["A","B"],
        "expenseCategories":["Shop"],"partnership":false,"websiteSelling":true,"invoiceByCustomer":true,"invoiceWhatsappPdf":true,"sizeToProfile":true}}"""

    @Test fun meReadsTheErpsAnswer() {
        val me = Me.fromJson(answer)!!
        assertEquals("owner", me.role)
        assertNull(me.karigar)
        assertEquals("Demo", me.shop?.person)
        assertEquals(listOf("A", "B"), me.shop?.takenBy)
        assertTrue(me.shop!!.websiteSelling)
    }

    @Test fun theCachedAnswerComesBackAsItWas() {
        val me = Me.fromJson(answer)!!
        assertEquals(me, Me.fromJson(me.toJson()))
        val k = Me("k@example.com", "karigar", Me.Karigar("K1", "Karim"), null)
        assertEquals(k, Me.fromJson(k.toJson()))
    }

    @Test fun anAnswerFromAnOlderBuildHasNoShopAndTheHouseDefaultsStandIn() {
        val me = Me.fromJson("""{"email":"a@example.com","role":"staff"}""")!!
        assertNull(me.shop)
        val mina = Shop.fallback("mina")
        assertEquals("MINA", mina.name)
        assertTrue(mina.partnership)
        assertFalse(mina.websiteSelling)
        val taheri = Shop.fallback("taheri")
        assertEquals("TAHERI", taheri.name)
        assertTrue(taheri.websiteSelling && taheri.invoiceByCustomer && taheri.sizeToProfile)
        assertFalse(taheri.partnership)
    }

    @Test fun aShopMissingAFieldTakesTheHousesDefault() {
        val s = Shop.from(mapOf("name" to "X", "websiteSelling" to false), "taheri")
        assertEquals("X", s.name)
        assertFalse(s.websiteSelling)
        assertTrue(s.invoiceByCustomer)
    }

    @Test fun theDemoShopHasMadeUpCounters() {
        val d = Shop.demo("mina")
        assertEquals("DEMO", d.name)
        assertEquals(3, d.takenBy.size)
        assertTrue(d.partnership)
    }

    @Test fun anAnswerWithoutAnEmailOrRoleIsNotAnAnswer() {
        assertNull(Me.fromJson("""{"role":"owner"}"""))
        assertNull(Me.fromJson("""{"email":"a@example.com"}"""))
        assertNull(Me.fromJson("[]"))
        assertNull(Me.fromJson(null))
    }

    @Test fun firebasesCodesAreSaidInTheShopsWords() {
        assertEquals("No connection to Google. Check the internet and try again.", Session.say("ERROR_NETWORK_REQUEST_FAILED"))
        assertEquals("This Google account hasn't been let in yet: the shop has to allow new sign-ins first.", Session.say("ERROR_ADMIN_RESTRICTED_OPERATION"))
        assertEquals("Too many tries. Wait a minute, then try again.", Session.say("ERROR_TOO_MANY_REQUESTS"))
        assertNull(Session.say("ERROR_SOMETHING_ELSE"))
        assertEquals("boom", Session.say(IllegalStateException("boom")))
    }

    private fun jwt(exp: Long?): String {
        val enc = Base64.getUrlEncoder().withoutPadding()
        val body = if (exp == null) "{}" else """{"exp":$exp}"""
        return enc.encodeToString("""{"alg":"none"}""".toByteArray()) + "." + enc.encodeToString(body.toByteArray()) + ".sig"
    }

    @Test fun aGoogleTokensExpiryIsReadFromItsPayload() {
        assertEquals(1_790_000_000_000L, Jwt.expiryMillis(jwt(1_790_000_000)))
        assertNull(Jwt.expiryMillis(jwt(null)))
        assertNull(Jwt.expiryMillis("nonsense"))
        assertNull(Jwt.expiryMillis("a.!!!.c"))
        assertEquals(10 * 60 * 1000L, Jwt.REFRESH_MARGIN_MS)
    }

    @Test fun theDevicesThemeBeatsTheShops() {
        assertEquals(false, ThemeChoice.preferredDark("default", "slate", ""))
        assertEquals(true, ThemeChoice.preferredDark("slate", "default", ""))
        assertEquals(true, ThemeChoice.preferredDark("taheri", null, ""))
        assertNull(ThemeChoice.preferredDark("system", "slate", ""), "the phone's own choice to follow the phone")
    }

    @Test fun withoutADeviceChoiceTheShopsThemeOrTheLastKnownOneStands() {
        assertEquals(false, ThemeChoice.preferredDark("", "default", "slate"))
        assertEquals(true, ThemeChoice.preferredDark("", "slate", "default"))
        // before the settings are read, a cold start opens in the theme they last said
        assertEquals(false, ThemeChoice.preferredDark("", null, "default"))
        assertEquals(true, ThemeChoice.preferredDark("", null, "taheri"))
        assertNull(ThemeChoice.preferredDark("", null, ""))
        assertNull(ThemeChoice.preferredDark("", "auto", ""))
    }
}
