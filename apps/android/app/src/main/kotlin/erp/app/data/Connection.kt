package erp.app.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Cached Firestore data is not evidence that the phone has lost its network connection: this says
 * "offline" only when Android has confirmed there is no network at all.
 */
object Connection {
    private val offline = MutableStateFlow(false)
    val isOffline: StateFlow<Boolean> = offline.asStateFlow()
    private var started = false

    fun start(context: Context) {
        if (started) return
        started = true
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
        offline.value = cm.activeNetwork == null
        runCatching {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { offline.value = false }
                override fun onLost(network: Network) { offline.value = true }
            })
        }
    }
}
