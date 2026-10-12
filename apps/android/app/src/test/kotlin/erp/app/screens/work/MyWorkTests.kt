package erp.app.screens.work

import erp.core.logic.KarigarPortalRules
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// My work (src/app/my-work/page.tsx): the addresses it asks for and the demo karigar's portal, run through core's
// KarigarPortalRules the way the screen lays it out. Made-up names and numbers only.
class MyWorkTests {
    private val now = Instant.parse("2026-10-12T11:05:00Z")

    @Test fun theAddressesItAsksFor() {
        assertEquals("/api/karigar/me", WorkPaths.portal(null))
        assertEquals("/api/karigar/me", WorkPaths.portal(""))
        assertEquals("/api/karigar/me?karigarId=KAR-D1", WorkPaths.portal("KAR-D1"))
        assertEquals("/api/karigar/me?karigarId=KAR%2F1%20%26%3F", WorkPaths.portal("KAR/1 &?"))
        assertEquals("KAR-D1", WorkPaths.query("preview", "/my-work?preview=KAR-D1"))
        assertEquals("KAR 1", WorkPaths.query("preview", "/my-work?preview=KAR%201"))
        assertNull(WorkPaths.query("preview", "/my-work"))
        assertEquals("", WorkPaths.query("preview", "/my-work?preview="))
    }

    @Test fun theClockIsKarachisInLowerCase() {
        // 11:05 UTC is 4:05 pm in Karachi.
        assertEquals("4:05 pm", MyWorkText.clock(now))
        assertEquals("12:30 am", MyWorkText.clock(Instant.parse("2026-10-11T19:30:00Z")))
    }

    @Test fun theDemoPortalLaysOutAsThePageDoes() {
        val p = assertNotNull(WorkDemo.portal(now))
        assertEquals("Ustad Demo", p.karigar?.name)
        assertEquals(false, p.preview)
        assertEquals(4, p.summary.active)
        val s = KarigarPortalRules.sections(p.jobs)
        assertEquals(4, s.active.size)
        assertEquals(listOf("order:ORD-D0002:0", "order:ORD-D0002:1"), s.critical.map { it.id })
        assertEquals(listOf("order:ORD-D0005:0"), s.late.map { it.id })
        assertEquals(listOf("job:JOB-D1"), s.onTrack.map { it.id })
        assertEquals(listOf("order:ORD-D0001:0"), s.done.map { it.id })
        assertTrue(s.done.all { it.isDone })
        val groups = KarigarPortalRules.groups(s.critical)
        assertEquals(1, groups.size)
        assertEquals("ORD-D0002", groups[0].orderId)
        assertEquals(2, groups[0].jobs.size)
        assertEquals("critical", groups[0].urgency)
        assertTrue(KarigarPortalRules.groups(s.onTrack)[0].isStock)
    }

    @Test fun thePiecesSpecsAndInstructions() {
        val p = assertNotNull(WorkDemo.portal(now))
        val bangles = p.jobs.first { it.id == "order:ORD-D0002:0" }
        assertEquals(listOf("Size", "Weight", "Type", "Karat"), KarigarPortalRules.specs(bangles).map { it.label })
        assertEquals(listOf("2.6", "22.5g", "Bangles", "21K"), KarigarPortalRules.specs(bangles).map { it.value })
        assertEquals(listOf(true, false, false, false), KarigarPortalRules.specs(bangles).map { it.accent })
        assertTrue(bangles.sampleGiven)
        assertEquals("Fine filigree on the outer face.\nSatin finish inside.", bangles.notes)
        assertEquals(listOf("Type", "Karat", "Qty"), KarigarPortalRules.specs(p.jobs.first { it.id == "job:JOB-D1" }).map { it.label })
    }

    @Test fun theAccountSaysGoldAndPayments() {
        val a = assertNotNull(WorkDemo.portal(now)).account
        assertEquals("48.500g", KarigarPortalRules.grams(a.goldGiven))
        assertEquals("26.250g", KarigarPortalRules.grams(a.goldNet))
        assertEquals(2, a.ledger.size)
        assertEquals(185_000.0, a.totalPaid)
        assertEquals(a.totalPaid, a.payments.sumOf { it.amount })
        assertTrue(KarigarPortalRules.date(a.payments[0].date, shortYear = true).matches(Regex("""\d\d [A-Z][a-z]{2} \d\d""")))
    }
}
