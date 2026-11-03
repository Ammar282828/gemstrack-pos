package erp.app.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Cached Firestore data is not evidence that the phone has lost its network connection: this says
 * "offline" only when Android has confirmed there is no network at all.
 *
 * Offline is a first-class state (owner, 2026-11-03: "it should fully handle not being connected at all in any situation"):
 * `isOffline` drives the app-wide banner (OfflineBanner), and every time the line comes back `regained` goes up and each
 * `onRegain` listener runs, so the Outbox sends what was waiting without anyone asking. (Connection.swift.)
 */
object Connection {
    private val offline = MutableStateFlow(false)
    val isOffline: StateFlow<Boolean> = offline.asStateFlow()
    private val regainedCount = MutableStateFlow(0)
    /** Goes up each time the line comes back after being lost. */
    val regained: StateFlow<Int> = regainedCount.asStateFlow()
    private val listeners = ArrayList<() -> Unit>()
    private var started = false

    /** Runs each time the connection returns (on the thread Android reports it from). */
    @Synchronized
    fun onRegain(listener: () -> Unit) { listeners.add(listener) }

    fun start(context: Context) {
        if (started) return
        started = true
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
        offline.value = cm.activeNetwork == null
        runCatching {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { set(false) }
                override fun onLost(network: Network) { set(true) }
            })
        }
    }

    /** The line goes or returns; a return wakes every listener. */
    fun set(isOffline: Boolean) {
        val was = offline.value
        if (was != isOffline) offline.value = isOffline
        if (was && !isOffline) {
            regainedCount.value = regainedCount.value + 1
            val all = synchronized(this) { listeners.toList() }
            for (l in all) runCatching { l() }
        }
    }

    /**
     * The request never reached the ERP, or its answer never came back: no line, a timeout, the server down. What a queued
     * write waits out, and what an awaited one hands to the Outbox. A timeout may have been recorded already, which is why
     * every queued write keeps its request name: sent again, it is the same change.
     */
    fun lost(e: Throwable): Boolean {
        if (e is ErpApi.Failure) return e.offline || e.status in listOf(502, 503, 504)
        return e is java.io.IOException
    }

    /** The request certainly never left the phone (no line at all): safe for a send that must never go twice. */
    fun neverLeft(e: Throwable): Boolean {
        if (e is ErpApi.Failure) return e.offline && e.neverLeft
        return neverLeftIo(e)
    }

    /** An IOException that says the connection was never made (as opposed to a timeout or a reset mid-answer). */
    internal fun neverLeftIo(e: Throwable): Boolean =
        e is UnknownHostException || e is ConnectException || e is NoRouteToHostException

    /** A timeout: the request may have been recorded. */
    internal fun timedOut(e: Throwable): Boolean = e is SocketTimeoutException
}
