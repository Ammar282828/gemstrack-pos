package erp.app.data

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import erp.app.auth.Session
import erp.app.config.House
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * After sign-in, once per launch and business, the few route reads people open most are asked for in the background so
 * [ReadCache] already holds an answer when their screen opens (that screen paints it at once and the ERP's answer replaces it:
 * `ErpApi.cachedThenFresh`). Low priority and polite: a few seconds after sign-in, one at a time, never on a metered line
 * or a low-RAM phone. The answers are the ones the screens ask for with their default period.
 */
object Prefetch {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val done = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    /** The routes this person's phone warms: only what their role may read and their house has. */
    fun routes(role: String, websiteSelling: Boolean, shopifyAnalytics: Boolean?): List<String> = buildList {
        if (role == "owner") add("/api/app/overheads")
        if ((role == "owner" || role == "marketing") && websiteSelling) add("/api/website/analytics?range=30d")
        if ((role == "owner" || role == "marketing") && shopifyAnalytics == true) add("/api/website/shopify-analytics?range=30d&compare=1")
    }

    /** Not on a metered line (mobile data the person pays for) or a phone short of memory. */
    internal fun polite(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        return cm?.isActiveNetworkMetered == false && am?.isLowRamDevice != true
    }

    fun warm(context: Context, session: Session) {
        if (House.isDemo || session.state.value != Session.State.SignedIn) return
        val app = context.applicationContext
        val list = routes(session.role, session.shop.websiteSelling, session.shop.shopifyAnalytics)
        if (list.isEmpty() || !polite(app)) return
        // Once per launch and business.
        if (!done.add(House.id)) return
        val api = ErpApi.shared
        scope.launch {
            // After the first screen has what it needs.
            delay(4_000)
            for (path in list) {
                try { api.data(path) } catch (e: CancellationException) { throw e } catch (e: Exception) { /* a warm-up that fails is just not warm */ }
                delay(500)
            }
        }
    }
}
