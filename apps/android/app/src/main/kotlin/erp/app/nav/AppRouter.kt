package erp.app.nav

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import erp.app.MainActivity
import erp.app.PageActivity
import erp.app.config.Business
import erp.app.config.BusinessRules
import erp.app.config.Businesses
import erp.app.device.Foreground
import erp.app.device.PushLogic
import kotlinx.coroutines.launch

/**
 * Where a link or a tapped notification (anything outside a screen) wants to go: the place opens over the tabs, as a PageActivity,
 * on the business it names (AppRouter.swift). `https://<erp host>/…` is an App Link (of any business on this phone), `erp://orders/ORD-000123`
 * is the app's own address, `shoperp://open?b=<business>&p=<path>` is a widget's tap, and a notification carries `url` and `business` in its data.
 * A business that is not the open one is switched to first; the page opens once the shell has been rebuilt on it.
 */
object AppRouter {
    /** Where a link wants to go: a business (null: the open one) and a path (null: just the app). */
    data class Target(val business: String?, val path: String?)

    /** A page waiting for the shell to be rebuilt on the business it belongs to. */
    @Volatile private var pending: String? = null

    /** Opens the place as a page over whatever is in front (its own Activity, so it gets the system's transition). */
    fun open(path: String) {
        Foreground.activity?.let { PageActivity.start(it, path) }
    }

    /**
     * The business an intent names is switched to now, before the shell is built (a cold start, or a link while the app runs: the
     * shell is then rebuilt on it). Returns the page to open, kept for the rebuilt shell when the business changed.
     */
    fun prepare(intent: Intent?): String? {
        val target = target(intent) ?: return null
        val to = target.business
        if (to != null && to != Businesses.current.id && Businesses.business(to) != null) {
            // The picker has nothing left to ask: the link chose.
            erp.app.screens.businesses.LaunchPicker.begin()
            erp.app.screens.businesses.LaunchPicker.dismiss()
            pending = target.path
            Businesses.switchTo(to)
            return null
        }
        if (to != null) { erp.app.screens.businesses.LaunchPicker.begin(); erp.app.screens.businesses.LaunchPicker.dismiss() }
        return target.path
    }

    /** What the shell, just rebuilt after a switch, was asked to open. */
    fun takePending(): String? = pending.also { pending = null }

    fun handle(from: Context, intent: Intent?) {
        val path = prepare(intent) ?: return
        PageActivity.start(from, path)
    }

    fun target(intent: Intent?): Target? {
        val data = intent?.data
        if (data != null) {
            val t = target(data.scheme, data.host, data.encodedPath, data.encodedQuery, Businesses.list.value.map { it.id to it.host })
            if (t != null) return t
        }
        // A notification's page: FCM puts its data in the extras (`business` names the ERP that sent it).
        val path = PushLogic.pathFor(intent?.getStringExtra("url")) ?: return null
        return Target(intent?.getStringExtra("business")?.takeIf { it.isNotBlank() }, path)
    }

    /** The place a link names: the business whose ERP it is for, and the path in it; null for anything that is not ours. */
    fun target(scheme: String?, host: String?, encodedPath: String?, encodedQuery: String?, hosts: List<Pair<String, String>>): Target? {
        when (scheme?.lowercase()) {
            "https" -> {
                val h = host?.lowercase() ?: return null
                val id = hosts.firstOrNull { it.second == h || BusinessRules.twin(it.second) == h }?.first ?: return null
                return Target(id, pathOf(encodedPath.orEmpty(), encodedQuery))
            }
            "erp" -> return Target(null, pathOf("/" + (host.orEmpty() + encodedPath.orEmpty()).trimStart('/'), encodedQuery))
            // A widget's tap: the app on that business and screen, never the browser.
            "shoperp" -> {
                if (host?.lowercase() != "open") return null
                val q = query(encodedQuery)
                val p = q["p"]?.takeIf { it.startsWith("/") && !it.startsWith("//") } ?: "/"
                return Target(q["b"]?.takeIf { it.isNotBlank() }, p)
            }
        }
        return null
    }

    private fun pathOf(base: String, encodedQuery: String?): String {
        val path = base.ifEmpty { "/" }
        return if (encodedQuery.isNullOrEmpty()) path else "$path?$encodedQuery"
    }

    private fun query(encoded: String?): Map<String, String> =
        encoded.orEmpty().split('&').filter { it.contains('=') }.associate {
            java.net.URLDecoder.decode(it.substringBefore('='), "UTF-8") to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8")
        }

    /**
     * The ERP path a link names for the open business, or null for anything that is not ours (the page bridge and the older callers' form:
     * a link is the open business's only when it names its host).
     */
    fun pathFor(scheme: String?, host: String?, encodedPath: String?, encodedQuery: String?, serverHost: String): String? {
        val base = when (scheme?.lowercase()) {
            "https" -> if (host.equals(serverHost, ignoreCase = true)) encodedPath.orEmpty() else return null
            "erp" -> "/" + (host.orEmpty() + encodedPath.orEmpty()).trimStart('/')
            else -> return null
        }
        return pathOf(base, encodedQuery)
    }

    /**
     * Every Activity is rebuilt on the new business: the task starts again at the tabs (no saved page of the one left), and whatever it
     * had open goes with it. The platform draws the transition; none is added.
     */
    fun restartShell(from: Activity) {
        from.startActivity(Intent(from, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
    }
}

/**
 * A shell is built for the business switches there had been when it began; when another happens it is rebuilt (`AppRouter.restartShell`).
 * Only an Activity in front rebuilds (a page above the tabs, or the tabs): the one under it goes with the task.
 */
fun FragmentActivity.rebuildOnBusinessSwitch() {
    val built = Businesses.generation.value
    lifecycleScope.launch {
        repeatOnLifecycle(Lifecycle.State.STARTED) {
            Businesses.generation.collect { g -> if (g != built) AppRouter.restartShell(this@rebuildOnBusinessSwitch) }
        }
    }
}
