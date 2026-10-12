package erp.app.nav

import android.content.Intent
import erp.app.config.House
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Where a link or a tapped notification (anything outside a screen) wants to go: the place opens over the tabs.
 * `https://<erp host>/…` is an App Link, `erp://orders/ORD-000123` is the app's own address.
 */
object AppRouter {
    private val _open = MutableStateFlow<String?>(null)
    val open: StateFlow<String?> = _open.asStateFlow()

    fun open(path: String) { _open.value = path }

    /** The root has taken it. */
    fun consumed() { _open.value = null }

    fun handle(intent: Intent?) {
        val data = intent?.data
        val path = data?.let { pathFor(it.scheme, it.host, it.encodedPath, it.encodedQuery, House.serverHost) }
            ?: intent?.getStringExtra("url")?.takeIf { it.startsWith("/") } // a notification's page
        if (path != null) open(path)
    }

    /** The ERP path a link names, or null for anything that is not ours. */
    fun pathFor(scheme: String?, host: String?, encodedPath: String?, encodedQuery: String?, serverHost: String): String? {
        val base = when (scheme?.lowercase()) {
            "https" -> if (host.equals(serverHost, ignoreCase = true)) encodedPath.orEmpty() else return null
            "erp" -> "/" + (host.orEmpty() + encodedPath.orEmpty()).trimStart('/')
            else -> return null
        }
        val path = base.ifEmpty { "/" }
        return if (encodedQuery.isNullOrEmpty()) path else "$path?$encodedQuery"
    }
}
