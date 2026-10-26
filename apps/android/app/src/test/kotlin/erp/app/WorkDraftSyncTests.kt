package erp.app

import erp.app.data.DraftIds
import erp.app.data.DraftOutboxFiles
import erp.app.data.DraftWire
import erp.app.data.ErpApi
import erp.app.data.WorkDraftSync
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

/**
 * Saved at every change, never auto-opened (decisions.md "Drafts", owner 2026-10-25): the line to /api/app/drafts as the
 * iPhone's WorkDraftSync keeps it. Fakes stand in for the network, the preferences and the files.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WorkDraftSyncTests {
    private class Sent(val business: String, val body: Map<String, Any?>) {
        val action: String get() = body["action"] as String
        val id: String get() = body["id"] as String
        @Suppress("UNCHECKED_CAST")
        val data: Map<String, Any?> get() = body["data"] as Map<String, Any?>
    }

    private class Rig(val scope: TestScope) {
        val sent = ArrayList<Sent>()
        var down = false
        var open = "taheri"
        var demo = false
        var check: Boolean? = true
        val kv = HashMap<String, String>()
        val disk = LinkedHashMap<String, DraftOutboxFiles.Record>()

        val sync = WorkDraftSync(
            "sale",
            scope = { scope },
            wire = DraftWire { business, body ->
                sent += Sent(business, body)
                if (down) throw ErpApi.Failure(0, "No connection")
                if (body["action"] == "check") mapOf("exists" to check) else emptyMap()
            },
            ids = object : DraftIds {
                override fun get(key: String, business: String) = kv["$key|$business"]
                override fun set(key: String, business: String, value: String?) {
                    if (value == null) kv.remove("$key|$business") else kv["$key|$business"] = value
                }
            },
            files = object : DraftOutboxFiles {
                override fun write(id: String, kind: String, biz: String, body: Map<String, Any?>) { disk[id] = DraftOutboxFiles.Record(id, biz, body) }
                override fun remove(id: String) { disk.remove(id) }
                override fun all(kind: String) = disk.values.toList()
            },
            clock = { scope.testScheduler.currentTime },
            openBusiness = { open },
            isDemo = { demo },
            knows = { true },
            device = { "Pixel" },
        )

        fun snap(name: String, total: Double = 10.0) = WorkDraftSync.Snapshot(mapOf("customerName" to name), total, name)
        fun push(name: String, now: Boolean = false, blank: Boolean = false, enabled: Boolean = true) =
            sync.push(blank = blank, enabled = enabled, now = now) { snap(name) }
        val saves: List<Sent> get() = sent.filter { it.action == "save" }
    }

    private fun TestScope.rig() = Rig(this)

    @Test fun theFirstChangeGoesAtOnceInTheWebFormsShape() = runTest {
        val r = rig()
        r.push("A")
        assertTrue(r.sent.isEmpty(), "nothing on the line before the scope runs")
        runCurrent()
        val s = r.saves.single()
        assertEquals("sale", s.body["kind"])
        assertEquals("Pixel", s.body["device"])
        assertEquals(10.0, s.body["total"])
        assertEquals("A", s.body["customerName"])
        assertEquals("A", s.data["customerName"])
        assertTrue((s.id).startsWith("sale-"), "the web's newDraftId form")
        assertNotNull(s.body["createdAt"])
    }

    @Test fun aBurstOfKeysIsOneWriteOfTheNewestWithinAThirdOfASecond() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        r.push("B")
        r.push("C")
        r.push("D")
        advanceTimeBy(WorkDraftSync.INTERVAL_MS - 1)
        runCurrent()
        assertEquals(1, r.saves.size, "inside the interval nothing more is sent")
        advanceTimeBy(1)
        runCurrent()
        assertEquals(2, r.saves.size)
        assertEquals("D", r.saves[1].data["customerName"])
        assertEquals(r.saves[0].id, r.saves[1].id, "the same draft is written over")
    }

    @Test fun theSameWorkIsNotSentTwice() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        advanceTimeBy(1000)
        r.push("A")
        advanceUntilIdle()
        assertEquals(1, r.saves.size)
    }

    @Test fun leavingSendsAtOnceWhateverIsWaiting() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        r.push("B")
        r.push("C", now = true)
        runCurrent()
        assertEquals(listOf("A", "C"), r.saves.map { it.data["customerName"] })
        advanceUntilIdle()
        assertEquals(2, r.saves.size, "the waiting write was the newest, now sent: nothing more is due")
    }

    @Test fun aBlankFormSendsNothingAndTakesItsDraftOut() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        val id = r.saves[0].id
        r.push("", blank = true)
        runCurrent()
        assertEquals(listOf("save", "drop"), r.sent.map { it.action })
        assertEquals(id, r.sent[1].id)
        assertNull(r.sync.id)
        // A blank form that never had a draft sends nothing at all.
        r.push("", blank = true)
        runCurrent()
        assertEquals(2, r.sent.size)
    }

    @Test fun nothingIsSentWhereDraftsAreOffOrInTheDemo() = runTest {
        val r = rig()
        r.push("A", enabled = false)
        r.demo = true
        r.push("B")
        advanceUntilIdle()
        assertTrue(r.sent.isEmpty())
        assertNull(r.sync.id)
    }

    @Test fun theNextFormIsANewDraftAndTheOldOneIsMadeSureOf() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        val first = r.saves[0].id
        // Typed since, still waiting: this is what is released, not lost.
        r.push("B")
        r.sync.release("taheri", enabled = true, snapshot = null)
        runCurrent()
        assertEquals(listOf("A", "B"), r.saves.map { it.data["customerName"] })
        assertEquals(first, r.saves[1].id, "the old form's last work lands under the old id")
        assertNull(r.sync.id, "the phone lets go of it")
        r.push("C")
        advanceUntilIdle()
        val second = r.saves.last()
        assertEquals("C", second.data["customerName"])
        assertNotEquals(first, second.id, "the new form never writes over the old draft")
        assertTrue(r.disk.isEmpty(), "everything that was kept on disk has landed")
    }

    @Test fun theHeldCopyIsSentWhenTheFormHadNothingPending() = runTest {
        val r = rig()
        r.sync.release("taheri", enabled = true) { r.snap("Held") }
        runCurrent()
        assertEquals("Held", r.saves.single().data["customerName"])
        r.sync.release("taheri", enabled = false) { r.snap("Not sent") }
        runCurrent()
        assertEquals(1, r.saves.size, "with drafts off the phone's copy has no place in Drafts to go")
    }

    @Test fun aSendThatFailsIsKeptOnDiskAndSentWhenTheLineIsBack() = runTest {
        val r = rig()
        r.down = true
        r.push("A")
        runCurrent()
        assertEquals(1, r.saves.size)
        assertEquals(1, r.disk.size, "kept for the retry")
        r.down = false
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(2, r.saves.size, "the backoff sent it again")
        assertEquals(r.saves[0].id, r.saves[1].id)
        assertEquals("A", r.saves[1].data["customerName"])
        assertTrue(r.disk.isEmpty())
    }

    @Test fun theAppComingForwardSendsWhatWaited() = runTest {
        val r = rig()
        r.down = true
        r.push("A")
        runCurrent()
        r.down = false
        r.sync.resume()
        runCurrent()
        assertEquals(2, r.saves.size)
        assertTrue(r.disk.isEmpty())
    }

    @Test fun aDraftDiscardedWhileWaitingIsNeverSentAgain() = runTest {
        val r = rig()
        r.down = true
        r.push("A")
        runCurrent()
        r.sync.abandon(r.saves[0].id)
        assertTrue(r.disk.isEmpty())
        r.down = false
        r.sync.resume()
        advanceUntilIdle()
        assertEquals(1, r.saves.size)
    }

    @Test fun savingTheSaleTakesOnlyItsOwnDraftOut() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        val id = r.saves[0].id
        r.sync.drop()
        runCurrent()
        assertEquals("drop", r.sent.last().action)
        assertEquals(id, r.sent.last().id)
        assertNull(r.sync.id)
        // Whatever was still on its way is not written after the remove.
        r.push("B", now = true)
        runCurrent()
        assertNotEquals(id, r.saves.last().id)
    }

    @Test fun aDraftContinuedFromDraftsIsWrittenOverAndStillThere() = runTest {
        val r = rig()
        r.sync.adopt("sale-abc-12345", "2026-10-25T08:00:00Z")
        assertEquals("sale-abc-12345", r.sync.id)
        assertEquals(true, r.sync.stillThere())
        r.push("Continued")
        runCurrent()
        val s = r.saves.single()
        assertEquals("sale-abc-12345", s.id)
        assertEquals("2026-10-25T08:00:00Z", s.body["createdAt"])
        r.check = false
        assertEquals(false, r.sync.stillThere(), "finished at the counter since")
    }

    @Test fun aDraftThatNeverLandedSaysNothingAboutThePhonesCopy() = runTest {
        val r = rig()
        r.down = true
        r.push("A")
        runCurrent()
        assertNull(r.sync.stillThere(), "no send has landed: not in Drafts says nothing")
        // The line comes back, so the backoff has something to finish.
        r.down = false
    }

    @Test fun leavingForAnotherBusinessSendsTheWaitingWorkToTheOneItWasTypedIn() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        r.push("B")
        r.sync.flush("taheri")
        r.open = "mina"
        r.sync.reset()
        advanceUntilIdle()
        assertEquals(listOf("A", "B"), r.saves.map { it.data["customerName"] })
        assertTrue(r.sent.all { it.business == "taheri" })
        assertFalse(r.sent.isEmpty())
    }

    @Test fun eachBusinessKeepsItsOwnDraft() = runTest {
        val r = rig()
        r.push("A")
        runCurrent()
        r.open = "mina"
        assertNull(r.sync.id)
        r.push("M")
        advanceUntilIdle()
        assertEquals(listOf("taheri", "mina"), r.saves.map { it.business })
        assertNotEquals(r.saves[0].id, r.saves[1].id)
    }

    @Test fun theIdIsTheWebsForm() {
        val id = WorkDraftSync.newId("order", nowMs = 1_000_000L, random = kotlin.random.Random(1))
        assertTrue(Regex("order-[0-9a-z]+-[a-z0-9]{5}").matches(id), id)
        assertEquals("order-" + 1_000_000L.toString(36) + "-", id.substringBeforeLast('-') + "-")
    }
}
