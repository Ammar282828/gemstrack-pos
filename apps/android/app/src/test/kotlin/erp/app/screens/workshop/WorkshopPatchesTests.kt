package erp.app.screens.workshop

import java.time.Instant
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

// The board's piece as the person just left it, until the shelf's copy agrees (WorkshopBoard.swift JobSig, JobPatch).
class WorkshopPatchesTests {
    private val now = Instant.parse("2026-10-12T07:00:00Z")

    private fun job(karigarId: String = "K1", status: WorkshopJob.Status = WorkshopJob.Status.pending, givenAt: String? = null) = WorkshopJob(
        id = "ORD-1#0", source = WorkshopJob.Source.order, karigarId = karigarId, karigarName = "Ustad Demo", description = "Ring",
        status = status, assignedDate = "2026-10-01T05:00:00.000Z", ageDays = 11, urgency = WorkshopJob.Urgency.warning, sortTime = 0.0, givenAt = givenAt,
    )

    private val names = mapOf("K2" to "Karigar Example")

    @Test fun aTickIsTheStatusChangedAndTheRestKept() {
        val j = job()
        val p = WorkshopPatches.next(j, null, status = WorkshopJob.Status.completed) { names[it] }
        val shown = WorkshopPatches.patched(j, p, now)
        assertEquals(WorkshopJob.Status.completed, shown.status)
        assertEquals("K1", shown.karigarId)
        assertFalse(shown.hasGiven)
    }

    @Test fun twoTapsOnTheSamePieceAreOnePatchFromTheShelfsCopy() {
        val j = job()
        val a = WorkshopPatches.next(j, null, status = WorkshopJob.Status.completed) { names[it] }
        val b = WorkshopPatches.next(j, a, given = true) { names[it] }
        assertEquals(JobSig(j), b.from)
        assertEquals(JobSig(WorkshopJob.Status.completed, true, "K1"), b.to)
    }

    @Test fun givenStampsNowOnlyIfItWasNotAlready() {
        val j = job()
        val on = WorkshopPatches.patched(j, WorkshopPatches.next(j, null, given = true) { names[it] }, now)
        assertEquals("2026-10-12T07:00:00.000Z", on.givenAt)
        val had = job(givenAt = "2026-10-05T05:00:00.000Z")
        val kept = WorkshopPatches.patched(had, WorkshopPatches.next(had, null, status = WorkshopJob.Status.inProgress) { names[it] }, now)
        assertEquals("2026-10-05T05:00:00.000Z", kept.givenAt)
        val off = WorkshopPatches.patched(had, WorkshopPatches.next(had, null, given = false) { names[it] }, now)
        assertNull(off.givenAt)
    }

    @Test fun aNewKarigarIsNamedAndNoneIsUnassigned() {
        val j = job()
        val to = WorkshopPatches.patched(j, WorkshopPatches.next(j, null, karigarId = "K2") { names[it] }, now)
        assertEquals("K2", to.karigarId)
        assertEquals("Karigar Example", to.karigarName)
        val none = WorkshopPatches.patched(j, WorkshopPatches.next(j, null, karigarId = "none") { names[it] }, now)
        assertTrue(none.isUnassigned)
        assertEquals("Unassigned", none.karigarName)
    }

    @Test fun aPatchLapsesOnceTheShelfHasMovedOffTheCopyItWasMadeFrom() {
        val j = job()
        val p = WorkshopPatches.next(j, null, status = WorkshopJob.Status.completed) { names[it] }
        val moved = job(status = WorkshopJob.Status.inProgress)
        assertSame(moved, WorkshopPatches.patched(moved, p, now))
        assertSame(j, WorkshopPatches.patched(j, null, now))
    }

    @Test fun theShelfAgreeingEndsThePatch() {
        val j = job()
        val p = WorkshopPatches.next(j, null, status = WorkshopJob.Status.completed) { names[it] }
        assertFalse(WorkshopPatches.agrees(j, p))
        assertTrue(WorkshopPatches.agrees(job(status = WorkshopJob.Status.completed), p))
    }
}
