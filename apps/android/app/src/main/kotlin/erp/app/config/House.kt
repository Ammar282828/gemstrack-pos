package erp.app.config

import android.content.Intent
import com.google.firebase.FirebaseOptions
import erp.app.BuildConfig
import erp.core.logic.MarginSettings

/**
 * The business that is open, as the places that say `House.id`, `House.serverUrl`, `House.margin` read it (House.swift). One app
 * holds many businesses (config/Businesses.kt); this is a thin facade over the open one, so nothing that reads it can freeze a
 * business's values at first use: every property is computed, per call. Changed only by `Businesses.switchTo`, which rebuilds
 * the shell. Every difference between the shops is a variable of the business, never a branch in code.
 */
object House {
    /** The whole descriptor of the business open now. */
    val business: Business get() = Businesses.current

    val id: String get() = business.id

    /** "Taheri ERP": the ERP's own name. Anything a customer or a karigar reads says `session.shop.name`. */
    val storeName: String get() = business.displayName
    val serverUrl: String get() = business.serverURL
    val metal: String get() = business.metal
    val applicationId: String = BuildConfig.APPLICATION_ID

    /** The ERP's host: the only place the app's sign-in token and the page bridge answer to. */
    val serverHost: String get() = business.host

    /** The id of the bundled art this business wears ("taheri", "mina"); an added business takes Taheri's for the files that ship with the app (menus, the artwork engine). */
    val art: String get() = business.art ?: "taheri"

    /** The same, but null for an added business: for a screen that belongs to one of the built-ins and must not appear for one that merely borrows Taheri's files. */
    val bundledArt: String? get() = business.art

    val googleWebClientId: String get() = business.android?.googleWebClientId.orEmpty().trim()

    /** The business's Firebase project (Settings → Backups links to its console). */
    val firebaseProjectId: String get() = business.android?.firebase?.projectId.orEmpty()

    /**
     * How the shop's own margin is worked out (lib/margin.ts, the house's COST_RATTI_LESS and STORE_EST_MARGIN): Taheri costs a
     * sale at 24K less 6 ratti, else 10%; Mina has no costing, 40%. Shop screens only: a customer never sees a margin.
     */
    val margin: MarginSettings get() = business.margin.settings

    fun marginFor(house: String): MarginSettings = if (house == "mina") MarginSettings.mina else MarginSettings.taheri

    const val DEMO_EXTRA = "erp.demo"

    /** The demo reads demo.json and never touches the server; a debug build can force it with -Derp.demo=true. */
    @Volatile var isDemo: Boolean = BuildConfig.PREVIEW_DEMO || (BuildConfig.DEBUG && System.getProperty("erp.demo") == "true")
        private set

    /** Launched with the extra `erp.demo` = true (the emulator check): made-up data, no sign-in, no Firebase. */
    fun applyIntent(intent: Intent?) {
        if (intent?.hasExtra(DEMO_EXTRA) == true) isDemo = intent.getBooleanExtra(DEMO_EXTRA, false)
    }

    /** Firebase options for the open business's project. Null until its Android app is registered in Firebase: the app then says so on its sign-in screen. */
    val firebaseOptions: FirebaseOptions? get() = Businesses.firebaseOptions(business)

    /** What the sign-in page says while Firebase is not configured (Session.State.NeedsSetup). */
    val needsSetupMessage: String get() = needsSetupMessage(business)

    fun needsSetupMessage(b: Business): String =
        "${b.displayName} isn't set up for this Android app yet. The owner has to register the Android app " +
            "(shop.taheri.erp, with this app's signing fingerprints) in its Firebase project. Your other businesses still work."
}
