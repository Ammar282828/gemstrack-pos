package erp.app.device

import android.os.Build
import androidx.glance.appwidget.updateAll
import com.google.firebase.messaging.FirebaseMessaging
import erp.app.ErpApp
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.screens.settings.NotificationAccess
import erp.app.screens.settings.NotificationPermission
import erp.app.widget.ErpWidget
import erp.app.widget.WidgetLinkData
import erp.app.widget.WidgetStore
import erp.app.widget.WidgetSync
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * What an owner's phone tells an ERP once signed in to it, and takes back on signing out (DeviceLinks.swift): where to send
 * notifications (lib/push on the server, `push_devices` entries with `platform: 'android'`), and the home-screen
 * widget's own key (/api/widget/key). Per business: each ERP is told in its own address and with its own sign-in.
 */
object DeviceLinks {
    /**
     * Asks for notifications (Android 13+ shows its prompt now, as the iPhone's does here, never at launch), takes the
     * FCM token and files it with the ERP; then links the widget. Neither failing stops the sign-in: Settings → This
     * phone says what is missing and registers again.
     */
    suspend fun afterSignIn(business: Business = Businesses.current) {
        if (House.isDemo || Businesses.firebaseApp(business) == null) return
        try {
            Push.register(business)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // the screen reads the state back from the ERP
        }
        try {
            WidgetLinker.link(business)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
        }
    }

    /**
     * Never waits more than a few seconds: offline, the sign-out must still happen (the unregister is a courtesy to the
     * server, tried first while the token is good, then let go). Only this business's alerts and widget key go; the others keep theirs.
     */
    suspend fun beforeSignOut(unregister: Boolean = true, business: Business = Businesses.current) {
        if (unregister) {
            // Whichever ends first: the request (itself capped at 3 s) or 3 s, should getting the token hang.
            withTimeoutOrNull(3_000) { runCatching { Push.unregister(business) } }
            // The key is taken back on the ERP first, so a lost phone's widget stops reading.
            withTimeoutOrNull(3_000) { runCatching { WidgetLinker.revoke(business) } }
        }
        WidgetLinker.clear(business)
    }
}

/** This phone's notifications (the iPhone's `Push.shared`). Settings → This phone reads the state back from the ERP. */
object Push {
    private var linking: Job? = null

    /** Whether each signed-in business has this phone's token (Settings → This phone lists them): by business id. */
    sealed interface LinkState {
        data object Linked : LinkState
        data class Failed(val why: String) : LinkState
    }

    private val _states = MutableStateFlow<Map<String, LinkState>>(emptyMap())
    val states: StateFlow<Map<String, LinkState>> = _states.asStateFlow()

    /** The open business's own FCM token (each business's Firebase project has its own sender, so each has its own token). */
    val token: String? get() = Prefs.string(PushLogic.TOKEN_KEY)

    fun token(business: Business): String? = Prefs.string(PushLogic.TOKEN_KEY, business.id)

    /**
     * FCM for a business's own Firebase app. `FirebaseMessaging.getInstance()` is the default app's only; the component of a named
     * app is the one `getInstance()` itself asks the default app for (`FirebaseApp.get`), so each business gets a token for its own
     * sender id. Null until the business's Android app is registered.
     */
    fun messaging(business: Business): FirebaseMessaging? = Businesses.firebaseApp(business)?.get(FirebaseMessaging::class.java)

    /**
     * Notifications allowed on the phone and the ERP's device record are separate; neither implies delivery. Asks
     * (Android 13+), takes the business's token and files it. Throws with the ERP's words when filing fails; returns quietly when the
     * phone does not allow notifications (Settings → This phone says so).
     */
    suspend fun register(business: Business = Businesses.current) {
        if (House.isDemo || Businesses.firebaseApp(business) == null) return
        if (NotificationPermission.state(ErpApp.instance) == NotificationAccess.NotAsked) NotificationPermission.request()
        if (NotificationPermission.state(ErpApp.instance) != NotificationAccess.Allowed) return
        val fresh = messaging(business)?.token?.await() ?: return
        Prefs.putString(PushLogic.TOKEN_KEY, fresh, business.id)
        link(business, fresh)
    }

    /**
     * The phone's tokens, once the app is in front: any business's that FCM has changed since it was filed (a reinstall, a restore, a
     * long idle) is filed again. Only the default app is told of a refresh (`onNewToken`), so the others are looked at here.
     */
    suspend fun refreshAll() {
        if (House.isDemo || NotificationPermission.state(ErpApp.instance) != NotificationAccess.Allowed) return
        for (b in Businesses.signedInBusinesses()) {
            val kept = token(b) ?: continue
            val fresh = runCatching { messaging(b)?.token?.await() }.getOrNull() ?: continue
            if (fresh != kept) {
                Prefs.putString(PushLogic.TOKEN_KEY, fresh, b.id)
                runCatching { link(b, fresh) }
            }
        }
    }

    /** FCM changed the default app's token: the new one is filed, if that business has somebody signed in. */
    suspend fun tokenRefreshed(fresh: String) {
        val b = Businesses.list.value.firstOrNull { it.id == Businesses.buildId } ?: return
        if (House.isDemo || Businesses.auth(b)?.currentUser == null) return
        if (NotificationPermission.state(ErpApp.instance) != NotificationAccess.Allowed) return
        Prefs.putString(PushLogic.TOKEN_KEY, fresh, b.id)
        linking?.cancel()
        linking = ErpApp.scope.launch { runCatching { link(b, fresh) } }
    }

    private suspend fun link(business: Business, token: String) {
        try {
            ErpApi.forBusiness(business).send("/api/push/devices", body = PushLogic.registerBody(token, House.applicationId, Build.MODEL))
            _states.value = _states.value + (business.id to LinkState.Linked)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _states.value = _states.value + (business.id to LinkState.Failed(e.message ?: "Couldn't reach the ERP."))
            throw e
        }
    }

    /** Forgets this phone at one business's ERP, while the sign-in token is good; the request is capped at 3 s. */
    suspend fun unregister(business: Business = Businesses.current) {
        linking?.cancel()
        linking = null
        val t = token(business)
        if (t != null) runCatching { ErpApi.forBusiness(business).send("/api/push/devices", method = "DELETE", body = PushLogic.unregisterBody(t), timeoutMs = 3_000) }
        Prefs.remove(PushLogic.TOKEN_KEY, business.id)
        _states.value = _states.value - business.id
    }
}

/** The home-screen widget's keys (/api/widget/key), one per business, sealed on this phone (widget/WidgetStore). */
object WidgetLinker {
    /**
     * Links one business. `force` asks for a fresh key even when one is kept; the kept link is replaced only once the new key has
     * arrived, so a failed relink (offline) never leaves a working widget unlinked. False if no key came. Other businesses' links are
     * never touched here: each is made when that business is signed in to.
     */
    suspend fun link(business: Business = Businesses.current, force: Boolean = false): Boolean {
        val context = ErpApp.instance
        if (!force) {
            val kept = WidgetStore.link(context, business.id)
            if (kept != null && kept.url == business.serverURL) {
                // The key stays; the name and colours follow the business (it may have changed them).
                val fresh = WidgetLinkData.of(business, kept.key)
                if (fresh != kept) { WidgetStore.save(context, fresh); runCatching { ErpWidget().updateAll(context) } }
                return true
            }
        }
        val key = try {
            ErpApi.forBusiness(business).send("/api/widget/key", body = WidgetLinkData.keyBody())["key"] as? String
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        } ?: return false
        // Signed out meanwhile: the key is not kept for a business that no longer has a sign-in.
        if (!House.isDemo && Businesses.auth(business)?.currentUser == null) return false
        if (!WidgetStore.save(context, WidgetLinkData.of(business, key))) return false
        WidgetSync.refreshSoon(context)
        return true
    }

    fun isLinked(business: Business = Businesses.current): Boolean = WidgetStore.link(ErpApp.instance, business.id) != null

    /** The businesses were described again (a new colour, name or logo): the widget's links follow, keeping their keys. */
    fun sync(list: List<Business>) {
        val context = ErpApp.instance
        var changed = false
        for (b in list) {
            val kept = WidgetStore.link(context, b.id) ?: continue
            val fresh = WidgetLinkData.of(b, kept.key)
            if (fresh != kept && WidgetStore.save(context, fresh)) changed = true
        }
        if (changed) ErpApp.scope.launch { runCatching { ErpWidget().updateAll(context) } }
    }

    /** Takes the business's key back on its ERP (DELETE /api/widget/key), while the sign-in token is good, so a lost phone's widget stops reading. */
    suspend fun revoke(business: Business) {
        val kept = WidgetStore.link(ErpApp.instance, business.id) ?: return
        ErpApi.forBusiness(business).send("/api/widget/key", method = "DELETE", body = mapOf("key" to kept.key), timeoutMs = 3_000)
    }

    /** Signing out or removing a business: only its key is forgotten here; the other businesses keep showing. */
    suspend fun clear(business: Business) {
        val context = ErpApp.instance
        WidgetStore.remove(context, business.id)
        runCatching { ErpWidget().updateAll(context) }
    }
}
