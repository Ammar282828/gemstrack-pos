package erp.app.device

import android.os.Build
import android.os.Process
import android.os.SystemClock
import erp.app.BuildConfig
import erp.app.ErpApp
import erp.app.config.House
import erp.app.data.ErpApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * How long a cold start takes on the shop's own phones, step by step (LaunchClock.swift; owner, 2026-10-20: "the app's
 * boot up is extremely slow"). Each step is stamped in milliseconds from the moment Android started the process; once
 * the open page has its books (or 20 s pass) the list is sent once to the ERP (`/api/app/launch`, kept in Firestore
 * `app_launches`), so a slow launch says where its seconds went instead of being guessed at.
 *
 * The list itself is [LaunchLog] (no Android in it, so a test can drive it); [LaunchClock] is the app's one, on the
 * process clock. Main thread.
 */
class LaunchLog(private val elapsedMs: () -> Long) {
    class Mark(val step: String, val ms: Int, val detail: String)

    val marks = ArrayList<Mark>()
    var sent = false
        private set

    /** Stamps a step once (the first time it happens on this launch); `detail` says what it was (a count, a source). */
    fun mark(step: String, detail: String = "") {
        if (sent || marks.any { it.step == step }) return
        marks += Mark(step, elapsedMs().toInt(), detail)
    }

    /** Ends the launch with the step that ended it ("home", "work", "timeout"): the body to send, once; null after that. */
    fun finish(ready: String, business: String, build: String, device: String): Map<String, Any?>? {
        if (sent) return null
        mark("ready:$ready")
        sent = true
        return mapOf(
            "marks" to marks.map { mapOf("step" to it.step, "ms" to it.ms, "detail" to it.detail) },
            "business" to business,
            "build" to build,
            "device" to device,
            "platform" to "android",
        )
    }
}

object LaunchClock {
    private val log = LaunchLog {
        // elapsedRealtime is the clock the platform stamps a process's start on; before the app exists (tests) it is 0.
        runCatching { SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime() }.getOrDefault(0L).coerceAtLeast(0L)
    }

    fun mark(step: String, detail: String = "") = log.mark(step, detail)

    /** Sends the launch's steps, once, if someone is signed in to be answered. */
    fun finish(ready: String) {
        if (House.isDemo || log.sent) return
        val body = log.finish(ready, House.id, "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", Build.MODEL ?: "") ?: return
        // A launch that ended on the sign-in page has nobody to report as.
        if (ErpApp.session.state.value != erp.app.auth.Session.State.SignedIn) return
        ErpApp.scope.launch(Dispatchers.IO) { runCatching { ErpApi.shared.send("/api/app/launch", body = body, timeoutMs = 8_000) } }
    }

    /** The launch gives up waiting for its books after 20 s and says so: a launch that never got there is the one to see. */
    fun armTimeout() {
        ErpApp.scope.launch {
            delay(20_000)
            finish("timeout")
        }
    }
}
