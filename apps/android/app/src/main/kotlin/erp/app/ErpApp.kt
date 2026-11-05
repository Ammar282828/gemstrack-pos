package erp.app

import coil3.request.crossfade
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
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okio.Path.Companion.toOkioPath

/**
 * The ERP as a native Android app (docs/features/android-app.md). One app, many businesses: Taheri and House of Mina ship in
 * it, others are added by their ERP's address, and the person switches between them (config/Businesses.kt). Each business has
 * its own Firebase app, made in code, not by google-services.json: a business's Android app may not be registered yet, and the
 * app then says so on its sign-in screen instead of crashing (`firebaseReady` false, as the iPhone's `firebaseOptions == nil`).
 */
class ErpApp : Application(), SingletonImageLoader.Factory {
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
        BiometricVault.init(this) // only keeps the Application (the vault reads it later), so it stays in line
        // Channels are an IPC to the system and idempotent; nothing needs them before the first frame (a push is seconds away at the soonest).
        ErpApp.background.launch { runCatching { NotificationChannels.create(this@ErpApp) } }
        if (!House.isDemo) ensureFirebase()
        Connection.start(this)
        erp.app.data.Outbox.start()
    }

    /**
     * Coil's one loader (Coil 3: `SingletonImageLoader.Factory`): a memory cache of 15 % of the app's heap and 200 MB on disk,
     * so the stock grid, the order photos and the piece pictures are not fetched again on every scroll or launch. The OkHttp
     * network fetcher (coil-network-okhttp) is found by the loader itself, as it is with the default one.
     */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            // A picture fades in over its placeholder (a request says crossfade(false) under Reduce Motion).
            .crossfade(true)
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.15).build() }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("image_cache").toOkioPath())
                    .maxSizeBytes(200L * 1024 * 1024)
                    .build()
            }
            .build()

    companion object {
        /** Work that is off the main thread and needs no screen (the launch's small chores). */
        private val background = CoroutineScope(SupervisorJob() + Dispatchers.Default)

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
