package erp.app.config

import android.content.Intent
import com.google.firebase.FirebaseOptions
import erp.app.BuildConfig
import erp.core.logic.MarginSettings

/** Which shop this build is. Every difference between the houses is a BuildConfig variable, never a branch in code. */
object House {
    val id: String = BuildConfig.HOUSE
    val storeName: String = BuildConfig.STORE_NAME
    val homeName: String = BuildConfig.HOME_NAME
    val serverUrl: String = BuildConfig.SERVER_URL
    val metal: String = BuildConfig.METAL
    val applicationId: String = BuildConfig.APPLICATION_ID

    /** The ERP's host: the only place the app's sign-in token and the page bridge answer to. */
    val serverHost: String = java.net.URI(serverUrl).host

    val firebaseProjectId: String = BuildConfig.FIREBASE_PROJECT_ID
    val firebaseApiKey: String = BuildConfig.FIREBASE_API_KEY
    val firebaseSenderId: String = BuildConfig.FIREBASE_SENDER_ID
    val firebaseStorageBucket: String = BuildConfig.FIREBASE_STORAGE_BUCKET
    val firebaseAndroidAppId: String = BuildConfig.FIREBASE_ANDROID_APP_ID.trim()
    val googleWebClientId: String = BuildConfig.GOOGLE_WEB_CLIENT_ID.trim()

    /**
     * How the shop's own margin is worked out (lib/margin.ts, the house's COST_RATTI_LESS and STORE_EST_MARGIN):
     * Taheri costs a sale at 24K less 6 ratti, else 10%; Mina has no costing, 40%. Shop screens only: a customer
     * never sees a margin.
     */
    val margin: MarginSettings = marginFor(id)

    fun marginFor(house: String): MarginSettings = if (house == "mina") MarginSettings.mina else MarginSettings.taheri

    const val DEMO_EXTRA = "erp.demo"

    /** The demo reads demo.json and never touches the server; a debug build can force it with -Derp.demo=true. */
    @Volatile var isDemo: Boolean = BuildConfig.PREVIEW_DEMO || (BuildConfig.DEBUG && System.getProperty("erp.demo") == "true")
        private set

    /** Launched with the extra `erp.demo` = true (the emulator check): made-up data, no sign-in, no Firebase. */
    fun applyIntent(intent: Intent?) {
        if (intent?.hasExtra(DEMO_EXTRA) == true) isDemo = intent.getBooleanExtra(DEMO_EXTRA, false)
    }

    /**
     * Firebase for this house's project. Null until the house's Android app is registered in Firebase
     * (houses.json firebaseAndroidAppId): the app then says so on its sign-in screen.
     */
    val firebaseOptions: FirebaseOptions? by lazy {
        if (!firebaseAndroidAppId.contains(":android:")) null
        else FirebaseOptions.Builder()
            .setApplicationId(firebaseAndroidAppId)
            .setApiKey(firebaseApiKey)
            .setProjectId(firebaseProjectId)
            .setGcmSenderId(firebaseSenderId)
            .setStorageBucket(firebaseStorageBucket)
            .build()
    }

    /** What the sign-in page says while Firebase is not configured (Session.State.NeedsSetup). */
    val needsSetupMessage: String
        get() = "This build can't reach the shop's book yet: the Android app is not registered in Firebase for " +
            "$firebaseProjectId (firebaseAndroidAppId in apps/android/houses.json is empty)."
}
