package erp.app.screens.workshop

import erp.core.ERPDate
import java.time.Instant

/** A piece's state in the three things a tap can change (WorkshopBoard.swift `JobSig`). */
data class JobSig(val status: WorkshopJob.Status, val given: Boolean, val karigarId: String) {
    constructor(job: WorkshopJob) : this(job.status, job.hasGiven, job.karigarId)
}

/** A piece as the person left it (`to`), good while the shelf's copy still reads `from`. */
data class JobPatch(val from: JobSig, val to: JobSig, val toName: String?)

/**
 * The board shows a tick, a hand-over or a new karigar at once and the Outbox carries the write (the shelf brings the
 * real copy), so the piece is laid over with what the person did until the shelf's copy has moved off the one it was.
 * Pure, so a test holds it.
 */
object WorkshopPatches {
    /**
     * What a tap adds to the piece's patch. Any of the three is given by the tap that changes it; the others stay as
     * the patch already had them (Done, then Given, is one patch). `karigarName` names a karigar by id.
     */
    fun next(
        job: WorkshopJob, existing: JobPatch?,
        status: WorkshopJob.Status? = null, given: Boolean? = null, karigarId: String? = null,
        karigarName: (String) -> String?,
    ): JobPatch {
        val from = existing?.from ?: JobSig(job)
        var to = existing?.to ?: from
        var name = existing?.toName
        if (status != null) to = to.copy(status = status)
        if (given != null) to = to.copy(given = given)
        if (karigarId != null) {
            to = to.copy(karigarId = if (karigarId == "none") WorkshopLogic.unassigned else karigarId)
            name = if (karigarId == "none") "Unassigned" else karigarName(karigarId) ?: job.karigarName
        }
        return JobPatch(from, to, name)
    }

    /** The piece as the person left it, until the shelf's copy has moved off the one it was. */
    fun patched(job: WorkshopJob, patch: JobPatch?, now: Instant = Instant.now()): WorkshopJob {
        if (patch == null || JobSig(job) != patch.from) return job
        return job.copy(
            karigarId = patch.to.karigarId,
            karigarName = patch.toName ?: job.karigarName,
            status = patch.to.status,
            givenAt = if (patch.to.given) (if (job.hasGiven) job.givenAt else ERPDate.iso(now)) else null,
        )
    }

    /** True when the shelf's copy now says what the person did: the patch can go. */
    fun agrees(job: WorkshopJob, patch: JobPatch): Boolean = JobSig(job) == patch.to
}
