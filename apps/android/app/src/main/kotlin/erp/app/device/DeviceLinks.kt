package erp.app.device

import android.os.Build
import androidx.glance.appwidget.updateAll
import com.google.firebase.messaging.FirebaseMessaging
import erp.app.ErpApp
import erp.app.auth.Session
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * What an owner's phone tells the ERP once signed in, and takes back on signing out (DeviceLinks.swift): where to send
 * notifications (lib/push on the server, `push_devices` entries with `platform: 'android'`), and the home-screen
 * widget's own key (/api/widget/key).
 */
object DeviceLinks {
    /**
     * Asks for notifications (Android 13+ shows its prompt now, as the iPhone's does here, never at launch), takes the
     * FCM token and files it with the ERP; then links the widget. Neither failing stops the sign-in: Settings → This
     * phone says what is missing and registers again.
     */
    suspend fun afterSignIn() {
        if (House.isDemo || !ErpApp.firebaseReady) return
        try {
            Push.register()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // the screen reads the state back from the ERP
        }
        try {
            WidgetLinker.link()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
        }
    }

    /**
     * Never waits more than a few seconds: offline, the sign-out must still happen (the unregister is a courtesy to the
     * server, tried first while the token is good, then let go).
     */
    suspend fun beforeSignOut(unregister: Boolean = true) {
        if (unregister) {
            // Whichever ends first: the request (itself capped at 3 s) or 3 s, should getting the token hang.
            withTimeoutOrNull(3_000) { runCatching { Push.unregister() } }
        }
        WidgetLinker.clear()
    }
}

/** This phone's notifications (the iPhone's `Push.shared`). Settings → This phone reads the state back from the ERP. */
object Push {
    private var linking: Job? = null

    val token: String? get() = Prefs.string(PushLogic.TOKEN_KEY)

    /**
     * Notifications allowed on the phone and the ERP's device record are separate; neither implies delivery. Asks
     * (Android 13+), takes the token and files it. Throws with the ERP's words when filing fails; returns quietly when the
     * phone does not allow notifications (Settings → This phone says so).
     */
    suspend fun register() {
        if (House.isDemo || !ErpApp.firebaseReady) return
        if (NotificationPermission.state(ErpApp.instance) == NotificationAccess.NotAsked) NotificationPermission.request()
        if (NotificationPermission.state(ErpApp.instance) != NotificationAccess.Allowed) return
        val fresh = FirebaseMessaging.getInstance().token.await()
        Prefs.putString(PushLogic.TOKEN_KEY, fresh)
        link(fresh)
    }

    /** FCM changed the token (reinstall, restore, a long idle): the new one is filed, if this is a signed-in owner's phone. */
    suspend fun tokenRefreshed(fresh: String) {
        val session = ErpApp.session
        if (session.state.value != Session.State.SignedIn || !session.isOwner) return
        if (NotificationPermission.state(ErpApp.instance) != NotificationAccess.Allowed) return
        Prefs.putString(PushLogic.TOKEN_KEY, fresh)
        linking?.cancel()
        linking = ErpApp.scope.launch { runCatching { link(fresh) } }
    }

    private suspend fun link(token: String) {
        ErpApi.shared.send("/api/push/devices", body = PushLogic.registerBody(token, House.applicationId, Build.MODEL))
    }

    /** Forgets this phone at the ERP, while the sign-in token is good; the request is capped at 3 s. */
    suspend fun unregister() {
        linking?.cancel()
        linking = null
        val t = token
        if (t != null) runCatching { ErpApi.shared.send("/api/push/devices", method = "DELETE", body = PushLogic.unregisterBody(t), timeoutMs = 3_000) }
        Prefs.remove(PushLogic.TOKEN_KEY)
    }
}

/** The home-screen widget's key (/api/widget/key), kept sealed on this phone (widget/WidgetStore). */
object WidgetLinker {
    /**
     * `force` asks for a fresh key even when one is kept; the kept link is replaced only once the new key has arrived,
     * so a failed relink (offline) never leaves a working widget unlinked. False if no key came.
     */
    suspend fun link(force: Boolean = false): Boolean {
        val context = ErpApp.instance
        if (!force) {
            val kept = WidgetStore.load(context)
            if (kept != null && kept.url == House.serverUrl) return true
        }
        val key = try {
            ErpApi.shared.send("/api/widget/key", body = WidgetLinkData.keyBody())["key"] as? String
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        } ?: return false
        if (!WidgetStore.save(context, WidgetLinkData(House.serverUrl, key, House.storeName))) return false
        WidgetSync.refreshSoon(context)
        return true
    }

    fun isLinked(): Boolean = WidgetStore.load(ErpApp.instance) != null

    /** Signing out: the key is forgotten here and the widget goes back to asking to be linked. */
    suspend fun clear() {
        val context = ErpApp.instance
        WidgetStore.clear(context)
        runCatching { ErpWidget().updateAll(context) }
    }
}
