package erp.app.screens.workshop

import erp.app.data.Demo
import erp.core.ERPDecode
import erp.core.logic.KarigarPay
import erp.core.models.Expense
import erp.core.models.GivenItem
import erp.core.models.HisaabEntry
import erp.core.models.Invoice
import erp.core.models.Karigar
import erp.core.models.KarigarBatch
import erp.core.models.KarigarJob
import erp.core.models.Order
import java.io.File
import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// The Workshop screens render from the demo books (CONVENTIONS.md rule 13): the board, the karigars, a karigar's page
// and the given items all work out from demo.json with the screens' own logic, with no gap in their words.
class DemoWorkshopTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private val docs: Map<String, List<Map<String, Any?>>> by lazy {
        val file = listOf("../../iphone/App/Resources/demo.json", "../iphone/App/Resources/demo.json", "apps/iphone/App/Resources/demo.json")
            .map { File(it) }.first { it.exists() }
        Demo.parse(file.readText(), now)
    }

    private inline fun <reified T : Any> all(name: String): List<T> = (docs[name] ?: emptyList()).map { ERPDecode.model<T>(it)!! }

    private val orders by lazy { all<Order>("orders") }
    private val invoices by lazy { all<Invoice>("invoices") }
    private val karigars by lazy { workshopLive(all<Karigar>("karigars")) }
    private val stockJobs by lazy { all<KarigarJob>("karigar_jobs") }
    private val given by lazy { all<GivenItem>("given_items") }
    private val hisaab by lazy { all<HisaabEntry>("hisaab") }
    private val batches by lazy { all<KarigarBatch>("karigar_batches") }
    private val expenses by lazy { all<Expense>("expenses") }
    private val jobs by lazy { WorkshopLogic.buildJobs(orders, stockJobs, karigars, invoices, now) }

    @Test fun theDemoHasABenchToShow() {
        assertTrue(karigars.size >= 2)
        // Cancelled and pending-but-unassigned orders: pieces on the bench come from the live orders only.
        assertTrue(jobs.none { it.orderId == "ORD-D0006" })
        assertTrue(jobs.any { it.orderId == "ORD-D0002" })
        assertTrue(jobs.any { it.isDone })
        assertTrue(jobs.all { it.description.isNotEmpty() && it.karigarName.isNotEmpty() })
        // Every piece is one the writes can find again.
        assertTrue(jobs.all { WorkshopLogic.writeTarget(it) != null })
    }

    @Test fun theBoardWorksOutInEveryFocusAndGrouping() {
        val snap = WorkshopSnapshot(jobs, WorkshopFilter())
        assertEquals(snap.filtered.count { !it.isDone }, snap.count(WorkshopFocus.all))
        for (f in WorkshopFocus.values()) {
            val shown = snap.focused(f)
            if (f != WorkshopFocus.all) assertEquals(shown.size, snap.count(f))
            for (g in WorkshopLogic.groupByKarigar(shown)) assertTrue(g.active >= 0 && g.karigarName.isNotEmpty())
            WorkshopLogic.groupJobsByOrder(shown)
            WorkshopLogic.byOrder(shown)
        }
        // The unassigned order (ORD-D0001, ORD-D0005) is work with nobody on it.
        assertTrue(snap.unassignedJobs.isNotEmpty())
        assertTrue(snap.unassignedJobs.all { it.isUnassigned })
        assertTrue(snap.stats.workers >= 1)
        for (j in jobs) {
            WorkshopLogic.meta(j)
        }
        for (s in WorkshopStatusFilter.values()) WorkshopSnapshot(jobs, WorkshopFilter(status = s))
        for (t in WorkshopTypeFilter.values()) WorkshopSnapshot(jobs, WorkshopFilter(type = t, query = "ring"))
        assertTrue(emptyWords(WorkshopFocus.all, true).first.isNotEmpty())
    }

    @Test fun eachKarigarHasAPageThatWorksOut() {
        for (k in karigars) {
            val p = WorkshopPosition(k.id, k.name, jobs, given, hisaab)
            assertTrue(p.bench.all { it.karigarId == k.id && !it.isDone })
            KarigarNow.weighHint(p)
            KarigarNow.cashTitle(KarigarNow.cash(p))
            KarigarNow.cashValue(KarigarNow.cash(p))
            val pay = KarigarPay.figures(k.id, expenses, batches)
            KarigarNow.cashHint(pay.open)
            pay.open?.let { KarigarNow.startedWords(it) }
            pay.settled.forEach { KarigarNow.settledWords(it); KarigarNow.deleteBatchDetail(it) }
            KarigarNow.footnote(true, KarigarPay.silver(k.id, emptyList()))
            val load = WorkshopLogic.groupByKarigar(jobs.filter { it.karigarId == k.id }).firstOrNull()
            if (load != null) {
                WorkshopLogic.shareText(load, "TAHERI")
                focusedCells(load, true)
                focusedSentence(load, 1)
            }
            assertEquals(k.id, WorkshopLogic.karigarId(WorkshopLogic.karigarPath(k.id)))
            assertEquals(k.id, WorkshopLogic.karigarEditId(WorkshopLogic.karigarPath(k.id) + "/edit"))
            assertTrue(WorkshopRoutes.any { it.matches(WorkshopLogic.karigarPath(k.id)) })
            assertNotNull(KarigarDraft.of(k).patch(null)["name"])
        }
        // The demo's first karigar has work, an open pay batch and a settled one.
        val ustad = karigars.first { it.id == "KAR-D1" }
        assertTrue(WorkshopPosition(ustad.id, ustad.name, jobs, given, hisaab).bench.isNotEmpty())
        val pay = KarigarPay.figures(ustad.id, expenses, batches)
        assertEquals("This month", pay.open?.batch?.label)
        assertEquals(1, pay.settled.size)
        // His open given item is on his page.
        assertEquals(listOf("GIV-D1"), WorkshopPosition(ustad.id, ustad.name, jobs, given, hisaab).given.map { it.id })
    }

    @Test fun theKarigarsListSplitsWorkingFromFree() {
        val loads = KarigarsLogic.loadsById(jobs)
        val (working, free) = KarigarsLogic.split(karigars, loads, "")
        assertEquals(karigars.size, working.size + free.size)
        assertTrue(working.isNotEmpty())
        assertEquals(setOf("KAR-D1", "KAR-D2"), WorkshopLogic.openBatches(batches).keys)
    }

    @Test fun theGivenItemsFilterAndSay() {
        assertTrue(given.size >= 2)
        for (f in GivenFilter.values()) for (g in given) GivenLogic.matches(g, f, "")
        assertEquals(1, given.count { GivenLogic.matches(it, GivenFilter.stillOut, "") })
        assertEquals(1, given.count { GivenLogic.matches(it, GivenFilter.returned, "") })
        assertEquals(1, given.count { GivenLogic.matches(it, GivenFilter.all, "sizing") })
        for (g in given) {
            assertTrue(GivenLogic.recipientWords(g).contains(g.recipientName))
            GivenLogic.recipientPath(g)
        }
        assertEquals("/karigars/KAR-D1", GivenLogic.recipientPath(given.first { it.id == "GIV-D1" }))
        val live = karigars
        assertEquals(2, suggestions(erp.core.models.GivenItemRecipientType.karigar, "", null, live, emptyList()).size)
    }
}
