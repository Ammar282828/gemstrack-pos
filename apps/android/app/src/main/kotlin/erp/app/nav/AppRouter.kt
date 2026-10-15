package erp.app.nav

import android.content.Context
import android.content.Intent
import erp.app.PageActivity
import erp.app.config.House
import erp.app.device.Foreground
import erp.app.device.PushLogic

/**
 * Where a link or a tapped notification (anything outside a screen) wants to go: the place opens over the tabs, as a PageActivity.
 * `https://<erp host>/…` is an App Link, `erp://orders/ORD-000123` is the app's own address.
 */
object AppRouter {
    /** Opens the place as a page over whatever is in front (its own Activity, so it gets the system's transition). */
    fun open(path: String) {
        Foreground.activity?.let { PageActivity.start(it, path) }
    }

    fun handle(from: Context, intent: Intent?) {
        val data = intent?.data
        val path = data?.let { pathFor(it.scheme, it.host, it.encodedPath, it.encodedQuery, House.serverHost) }
            ?: PushLogic.pathFor(intent?.getStringExtra("url")) // a notification's page: FCM puts its data in the extras
        if (path != null) PageActivity.start(from, path)
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
