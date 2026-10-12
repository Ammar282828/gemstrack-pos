package erp.app.data

import erp.core.Json
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Online orders waiting to be confirmed, for the Orders badge (and later the dashboard): the one poll of
 * /api/website/online?count=1, every two minutes while the app is in front of an owner or staff account.
 */
object OnlineInbox {
    /** The rates pause (the website holds orders while the rates are stale); `ratesUpdatedAt` is the ISO time the rates last changed. */
    data class RatePause(val ratesUpdatedAt: String?)

    private val _waiting = MutableStateFlow(0)
    val waiting: StateFlow<Int> = _waiting.asStateFlow()
    private val _ratePause = MutableStateFlow<RatePause?>(null)
    val ratePause: StateFlow<RatePause?> = _ratePause.asStateFlow()
    private var asking = false

    /** Ask now, then every two minutes, until the coroutine is cancelled. */
    suspend fun keep() {
        while (true) {
            refresh()
            delay(120_000)
        }
    }

    /** One question at a time: a second ask while one is out is the same answer. */
    suspend fun refresh() {
        if (asking) return
        asking = true
        try {
            val json = Json.parse(ErpApi.shared.data("/api/website/online?count=1")) as? Map<*, *> ?: return
            apply(json)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // No answer: what is shown stays.
        } finally {
            asking = false
        }
    }

    internal fun apply(json: Map<*, *>) {
        val count = (json["waiting"] as? Number)?.toInt() ?: 0
        val pause = if (json["pausedForRates"] == true) RatePause(json["ratesUpdatedAt"] as? String) else null
        if (_waiting.value != count) _waiting.value = count
        if (_ratePause.value != pause) _ratePause.value = pause
    }

    fun clear() {
        _waiting.value = 0
        _ratePause.value = null
    }
}
