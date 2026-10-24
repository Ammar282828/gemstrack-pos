package erp.app

import android.app.Application
import erp.app.auth.Session
import erp.app.auth.Sessions
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.Connection
import erp.app.device.BiometricVault
import erp.app.device.CrashCatcher
import erp.app.device.NotificationChannels
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * The ERP as a native Android app (docs/features/android-app.md). One app, many businesses: Taheri and House of Mina ship in
 * it, others are added by their ERP's address, and the person switches between them (config/Businesses.kt). Each business has
 * its own Firebase app, made in code, not by google-services.json: a business's Android app may not be registered yet, and the
 * app then says so on its sign-in screen instead of crashing (`firebaseReady` false, as the iPhone's `firebaseOptions == nil`).
 */
class ErpApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        // The launch report's clock starts with the process; its steps are stamped as they come (LaunchClock).
        erp.app.device.LaunchClock.armTimeout()
        erp.app.device.LaunchClock.mark("app:init")
        CrashCatcher.install(this)
        Prefs.init(this)
        // The businesses first (this moves what the one-business build kept, and tells core the open one's metal and margin).
        Businesses.init(this)
        BiometricVault.init(this)
        NotificationChannels.create(this)
        if (!House.isDemo) ensureFirebase()
        Connection.start(this)
    }

    companion object {
        lateinit var instance: ErpApp
            private set

        /** Work that outlives a screen: follow-ups of a write, the polls, a draft's sends. */
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

        /** The open business's Firebase app exists: false in the demo and while its Android app is not registered. */
        val firebaseReady: Boolean get() = !House.isDemo && Businesses.firebaseApp(Businesses.current) != null

        /** Makes the open business's Firebase app (and its Firestore settings) if it has an Android app to make one from. */
        fun ensureFirebase(): Boolean {
            if (House.isDemo) return false
            val b = Businesses.current
            Businesses.firestore(b)
            return Businesses.firebaseApp(b) != null
        }

        /** The open business's session (one per business: `Sessions`), made after the launch intent has said whether this is the demo. */
        val session: Session get() = Sessions.current
    }
}
