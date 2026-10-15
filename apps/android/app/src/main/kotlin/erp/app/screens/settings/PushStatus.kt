package erp.app.screens.settings

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.device.Push
import erp.app.device.PushLogic
import erp.app.device.Foreground
import java.net.URLEncoder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** This phone is not on the ERP's list for notifications (the iPhone's `PushError.notRegistered`). */
class PushNotRegistered : Exception("This phone isn't linked for notifications yet. Try registering it again.")

/**
 * What "This phone" needs of the push layer (the iPhone's `Push.shared`), so the screen is built against this and not
 * against Firebase Cloud Messaging (device/DeviceLinks.kt `Push` is the real one behind it).
 * Everything here is the ERP's own routes with this phone's token: /api/push/devices GET / POST / DELETE and
 * /api/push/test. Replace [PhonePush.current] to change where the answers come from (a test does).
 */
interface PushStatus {
    /** True once the ERP has this phone on its list (a registration, or a read that found it). */
    val registeredOnServer: StateFlow<Boolean>

    /** A registration is on its way. */
    val registering: StateFlow<Boolean>

    /** Why the last registration did not happen, in words. */
    val registrationError: StateFlow<String?>

    /** Asks the push layer to link this phone (the token to the ERP). */
    suspend fun register()

    /** Whether the ERP has this phone on its list. */
    suspend fun registered(): Boolean

    /** The kinds this phone has switched off. Throws [PushNotRegistered] when the ERP does not know this phone. */
    suspend fun kindsOff(): List<String>

    /** Saves the kinds this phone has switched off. */
    suspend fun setKindsOff(off: List<String>)

    /** Asks the ERP to send this phone a test notification. */
    suspend fun sendTest()
}

/** The default [PushStatus]: the iPhone's routes with the token that [DeviceLinks] keeps (`erp.pushToken` in the preferences). */
class ServerPushStatus(
    private val token: () -> String? = { Prefs.string(TOKEN_KEY) },
    private val link: suspend () -> Unit = { Push.register() },
) : PushStatus {
    private val _registered = MutableStateFlow(false)
    override val registeredOnServer: StateFlow<Boolean> = _registered.asStateFlow()
    private val _registering = MutableStateFlow(false)
    override val registering: StateFlow<Boolean> = _registering.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    override val registrationError: StateFlow<String?> = _error.asStateFlow()

    override suspend fun register() {
        _error.value = null
        _registering.value = true
        try {
            // Push.register: asks for notifications if not yet asked, takes the FCM token, keeps it, files it with the ERP.
            link()
            _registered.value = token() != null && PhoneLogic.isRegistered(runCatching { devices(token()!!) }.getOrNull())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            _error.value = e.message ?: e.toString()
        } finally {
            _registering.value = false
        }
    }

    override suspend fun registered(): Boolean = try { kindsOff(); true } catch (e: PushNotRegistered) { false }

    override suspend fun kindsOff(): List<String> {
        val t = token() ?: throw PushNotRegistered()
        val answer = devices(t)
        if (!PhoneLogic.isRegistered(answer)) {
            _registered.value = false
            throw PushNotRegistered()
        }
        _registered.value = true
        return PhoneLogic.off(answer)
    }

    override suspend fun setKindsOff(off: List<String>) {
        val t = token()
        if (!_registered.value || t == null) throw PushNotRegistered()
        ErpApi.shared.send("/api/push/devices", body = PhoneLogic.offBody(t, House.applicationId, off))
    }

    override suspend fun sendTest() {
        val t = token()
        if (!_registered.value || t == null) throw PushNotRegistered()
        ErpApi.shared.send("/api/push/test", body = mapOf("token" to t))
    }

    private suspend fun devices(token: String): Any? = ErpApi.shared.get("/api/push/devices?token=" + URLEncoder.encode(token, "UTF-8"))

    companion object {
        /** The iPhone's key for it (UserDefaults `erp.pushToken`); [Push] keeps the token here. */
        const val TOKEN_KEY = PushLogic.TOKEN_KEY
    }
}

/** Where the screen finds the push layer. */
object PhonePush {
    @Volatile var current: PushStatus = ServerPushStatus()
}

/** What the phone lets the app show (UNAuthorizationStatus, in Android's terms). */
enum class NotificationAccess { Allowed, Denied, NotAsked }

object NotificationPermission {
    private const val ASKED_KEY = "erp.notifications.asked"

    /**
     * Android 13+ asks (POST_NOTIFICATIONS) and keeps no "not decided" state apart from not having been asked yet, which
     * the app remembers; before 13 notifications are on unless the person has turned the app's off.
     */
    fun decide(sdk: Int, granted: Boolean, enabled: Boolean, asked: Boolean): NotificationAccess = when {
        sdk >= 33 && !granted -> if (asked) NotificationAccess.Denied else NotificationAccess.NotAsked
        !enabled -> NotificationAccess.Denied
        else -> NotificationAccess.Allowed
    }

    fun state(context: Context): NotificationAccess {
        val granted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        return decide(Build.VERSION.SDK_INT, granted, NotificationManagerCompat.from(context).areNotificationsEnabled(), Prefs.bool(ASKED_KEY) == true)
    }

    /** Asks (Android 13+); true if allowed. Remembers that it asked. */
    suspend fun request(): Boolean {
        Prefs.putBool(ASKED_KEY, true)
        if (Build.VERSION.SDK_INT < 33) return true
        val launchers = Foreground.launchers ?: return false
        return launchers.permission(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** This app's notification settings in the phone's Settings. */
    fun openSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .also { if (context !is Activity) it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        runCatching { context.startActivity(intent) }
    }
}

/** This phone's pure rules (PhoneSettings.swift, DeviceLinks.swift `Push`). */
object PhoneLogic {
    class Kind(val id: String, val title: String, val detail: String)

    val kinds = listOf(
        Kind("sales", "Sales", "A new sale"),
        Kind("payments", "Payments", "A payment on an invoice, a transfer slip from the website, a payment on Shopify"),
        Kind("orders", "Orders", "A new order, one finished or cancelled, online orders waiting"),
        Kind("karigar", "Karigars", "A karigar marking a piece done"),
    )

    /** /api/push/devices?token=… said `registered: true`. */
    fun isRegistered(answer: Any?): Boolean = (answer as? Map<*, *>)?.get("registered") == true

    /** The kinds the ERP says are off. */
    fun off(answer: Any?): List<String> = ((answer as? Map<*, *>)?.get("off") as? List<*>).orEmpty().mapNotNull { it as? String }

    /** The switches after one is turned: [kind] on or off, kept in a stable order. */
    fun toggled(off: Set<String>, kind: String, on: Boolean): Set<String> = if (on) off - kind else off + kind

    /** POST /api/push/devices {token, bundleId, off}: the iPhone's body, with the platform named. */
    fun offBody(token: String, bundleId: String, off: List<String>): Map<String, Any?> =
        mapOf("token" to token, "bundleId" to bundleId, "platform" to "android", "off" to off)
}
