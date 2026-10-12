package erp.app.config

import android.content.Intent
import erp.app.BuildConfig

/** Which shop this build is. Every difference between the houses is a BuildConfig variable, never a branch in code. */
object House {
    val id: String = BuildConfig.HOUSE
    val storeName: String = BuildConfig.STORE_NAME
    val homeName: String = BuildConfig.HOME_NAME
    val serverUrl: String = BuildConfig.SERVER_URL
    val metal: String = BuildConfig.METAL

    val firebaseProjectId: String = BuildConfig.FIREBASE_PROJECT_ID
    val firebaseApiKey: String = BuildConfig.FIREBASE_API_KEY
    val firebaseSenderId: String = BuildConfig.FIREBASE_SENDER_ID
    val firebaseStorageBucket: String = BuildConfig.FIREBASE_STORAGE_BUCKET
    val firebaseAndroidAppId: String = BuildConfig.FIREBASE_ANDROID_APP_ID
    val googleWebClientId: String = BuildConfig.GOOGLE_WEB_CLIENT_ID

    const val DEMO_EXTRA = "erp.demo"

    /** The demo reads demo.json and never touches the server; a debug build can force it with -Derp.demo=true. */
    @Volatile var isDemo: Boolean = BuildConfig.DEBUG && System.getProperty("erp.demo") == "true"
        private set

    fun applyIntent(intent: Intent?) {
        if (intent?.hasExtra(DEMO_EXTRA) == true) isDemo = intent.getBooleanExtra(DEMO_EXTRA, false)
    }
}
