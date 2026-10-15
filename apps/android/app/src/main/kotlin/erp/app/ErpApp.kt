package erp.app

import android.app.Application
import com.google.firebase.FirebaseApp
import erp.app.auth.Session
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.Connection
import erp.app.data.FirestoreSource
import erp.app.device.BiometricVault
import erp.app.device.CrashCatcher
import erp.app.device.NotificationChannels
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/**
 * The ERP as a native Android app (docs/features/android-app.md). One codebase, two houses: the house is a
 * BuildConfig variable per flavor (config/House.kt). Firebase is configured here in code, not by
 * google-services.json: the house's Android app may not be registered yet, and the app then says so on its
 * sign-in screen instead of crashing (`firebaseReady` false, as the iPhone's `House.firebaseOptions == nil`).
 */
class ErpApp : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
        CrashCatcher.install(this)
        // core knows no BuildConfig: the New order / New sale rules learn the house here, once.
        erp.core.entry.EntryHouse.id = House.id
        Prefs.init(this)
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

        @Volatile var firebaseReady = false
            private set

        private val lock = Any()

        /** Once: FirebaseApp.initializeApp and Firestore's settings. False in the demo and while the house has no Android app ID. */
        fun ensureFirebase(): Boolean {
            if (House.isDemo) return false
            synchronized(lock) {
                if (firebaseReady) return true
                val options = House.firebaseOptions ?: return false
                if (FirebaseApp.getApps(instance).none { it.name == FirebaseApp.DEFAULT_APP_NAME }) {
                    FirebaseApp.initializeApp(instance, options)
                }
                FirestoreSource.configure()
                firebaseReady = true
                return true
            }
        }

        /** The one Session of the process, made after the launch intent has said whether this is the demo. */
        val session: Session by lazy { Session(instance) }
    }
}
