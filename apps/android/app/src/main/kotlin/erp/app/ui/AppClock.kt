package erp.app.ui

import java.time.Instant

/**
 * "Now" for everything a screen says about time (due dates, "2 days ago", the demo's relative dates). The system's
 * clock unless a test pins it, so the screenshot baselines do not change with the day they are checked on.
 */
object AppClock {
    @Volatile var pinned: Instant? = null

    fun now(): Instant = pinned ?: Instant.now()
}
