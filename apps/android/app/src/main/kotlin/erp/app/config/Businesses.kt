package erp.app.config

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings
import erp.app.BuildConfig
import erp.app.data.WorkDraftSync
import java.io.File
import java.io.IOException
import java.util.Collections
import java.util.IdentityHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * The businesses this phone knows and the one that is open (Businesses.swift). One app, many businesses: Taheri and House of
 * Mina ship in it, any other is added by typing its ERP's address (the ERP describes itself at `GET /api/app/business`).
 * Everything per business hangs off the id: its Firebase app (and so its sign-in and its Firestore, independently of the
 * others), its settings (`Prefs`), its Outbox and write names (`OutboxDisk`), its books and session, its push registration,
 * its widget key. A switch lets go of the business left, rebuilds the shell on the new one ([generation]), and never lets
 * books or work cross.
 *
 * The rules (what a descriptor may say, how the list merges) are `BusinessRules` and `BusinessStore`, plain Kotlin and tested;
 * this object is their Android side: the files, the Firebase apps, the switch.
 */
object Businesses {
    private var app: Application? = null
    private var store: BusinessStore? = null

    private val _list = MutableStateFlow<List<Business>>(emptyList())

    /** The businesses on this phone, in the order the person keeps them. */
    val list: StateFlow<List<Business>> = _list.asStateFlow()

    private val _current = MutableStateFlow(fallback())

    /** The open business, as a flow (the demo's is [current] only: it is a launch flag, not a business to switch to). */
    val currentFlow: StateFlow<Business> = _current.asStateFlow()

    private val _generation = MutableStateFlow(0)

    /** Goes up on every switch: each Activity of the app rebuilds itself on the new business (MainActivity, PageActivity). */
    val generation: StateFlow<Int> = _generation.asStateFlow()

    private val _sheetOpen = MutableStateFlow(false)

    /** The Businesses sheet is open: the chip, the sign-in page and the cold-start picker open it; MainActivity hosts it. */
    val sheetOpen: StateFlow<Boolean> = _sheetOpen.asStateFlow()

    fun openSheet() { _sheetOpen.value = true }
    fun closeSheet() { _sheetOpen.value = false }

    /** The build's own business: Taheri for the one app, Mina for the deprecated Mina flavor. */
    val buildId: String = BuildConfig.HOUSE

    /** Taheri's build holds many businesses; the deprecated Mina build holds its own (its Firebase app is for its own id). */
    val canAdd: Boolean get() = buildId == "taheri"

    /** The Firebase app of the build's own business is the default app, so an existing install stays signed in. */
    fun appName(b: Business): String = if (b.id == buildId) FirebaseApp.DEFAULT_APP_NAME else "b-" + b.id

    val current: Business
        get() = if (House.isDemo) demo else _current.value

    fun business(id: String): Business? = _list.value.firstOrNull { it.id == id }

    /** The demo's one business: the build's own look, no Firebase, never saved. */
    private val demo: Business by lazy {
        val base = bundledForBuild().firstOrNull { it.id == buildId } ?: fallback()
        base.copy(android = null)
    }

    fun init(application: Application) {
        app = application
        Prefs.scope = { current.id }
        // What the one-business build kept under unsuffixed names is the build's own business's.
        Prefs.moveLegacy(buildId)
        val s = BusinessStore(File(application.filesDir, "erp-businesses.json"), bundledForBuild())
        store = s
        _list.value = s.list
        _current.value = BusinessStore.start(s.list, Prefs.string(Prefs.BUSINESS_CURRENT), buildId)
        applyToCore()
    }

    // MARK: Bundled

    /** The built-ins (assets/businesses.json, written by apps/iphone/scripts/businesses.mjs): no network on a first launch. */
    private fun bundledForBuild(): List<Business> {
        val all = runCatching { app?.assets?.open("businesses.json")?.bufferedReader()?.use { it.readText() } }.getOrNull()
            ?.let { Business.decodeList(it) }.orEmpty()
        val mine = if (buildId == "taheri") all else all.filter { it.id == buildId }
        return mine.ifEmpty { listOf(fallback()) }
    }

    /** What stands in before the app exists (a unit test) or if the bundled list cannot be read: the build's own, from BuildConfig. */
    private fun fallback(): Business {
        val mina = BuildConfig.HOUSE == "mina"
        val palette = if (mina) {
            Business.Palette(Business.Side("#380000", "#F2E9E4", "#FFFFFF", "#FBF9F9", "#FFFFFF"), Business.Side("#EBA9B3", "#090405", "#22131A", "#251318", "#2C1A21"))
        } else {
            Business.Palette(Business.Side("#8A6B42", "#ECE8E1", "#FFFFFF", "#FFFFFF", "#FFFFFF"), Business.Side("#D3B47F", "#030606", "#172020", "#0B1414", "#202A29"))
        }
        return Business(
            version = 1, id = BuildConfig.HOUSE, name = if (mina) "MINA" else "TAHERI", shortName = BuildConfig.HOME_NAME,
            storeName = BuildConfig.STORE_NAME, serverURL = BuildConfig.SERVER_URL, metal = BuildConfig.METAL,
            margin = if (mina) Business.Margin.Percent(40.0) else Business.Margin.RattiLess(6.0),
            palette = palette, logo = Business.Logo(null, null, 4.0), icon = null, android = null, flags = null, minBuild = null,
        )
    }

    // MARK: Adding

    /** Where a descriptor is asked for; replaced in tests. */
    internal var fetch: suspend (url: String) -> DescriptorAnswer = ::fetchOverHttps

    private val http: OkHttpClient by lazy {
        // The descriptor is public and asked for before anyone has signed in: no cookie, no cache, nothing of ours in it.
        OkHttpClient.Builder().cache(null).cookieJar(CookieJar.NO_COOKIES).followSslRedirects(false)
            .connectTimeout(10, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS).build()
    }

    private suspend fun fetchOverHttps(url: String): DescriptorAnswer = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url).header("Accept", "application/json").build()
        try {
            http.newCall(request).execute().use { DescriptorAnswer(it.code, it.request.url.host, it.body.string()) }
        } catch (e: IOException) {
            throw BusinessFailure("Couldn't reach ${Business.hostOf(url).ifEmpty { "that address" }}. Check it and the internet.")
        }
    }

    /**
     * Reads and judges the business whose ERP is at `address` ("erp.example.shop", "https://erp.example.shop/anything"): the
     * origin over https, its descriptor fetched and checked. Keeps nothing: the Businesses sheet shows what comes back as a
     * preview card, and [add] keeps it.
     */
    suspend fun describe(address: String): Business {
        if (House.isDemo) throw BusinessFailure("The demo can't add a business.")
        if (!canAdd) throw BusinessFailure("Add businesses in the ERP app (Taheri ERP): this build is House of Mina's own.")
        val origin = BusinessRules.origin(address)
        val answer = fetch("$origin/api/app/business")
        return BusinessRules.judge(origin, answer, _list.value)
    }

    /** Adds the business whose ERP is at `address` (see [describe]), kept. An address already added is refreshed. Does not switch. */
    suspend fun add(address: String): Business = put(describe(address))

    fun put(b: Business): Business {
        val s = store ?: return b
        val kept = s.put(b)
        _list.value = s.list
        if (_current.value.id == kept.id) _current.value = kept
        return kept
    }

    // MARK: Removing / ordering

    /** Moves a business in the list (the sheet's reorder). */
    fun move(from: Int, to: Int) {
        val s = store ?: return
        s.move(from, to)
        _list.value = s.list
    }

    /**
     * Forgets a business on this phone: its sign-in, its books on disk, its settings, its widget key and its unsent saves. The
     * last one cannot go. If it is the open one, the first of the others opens. `signOut` is the part that needs the network
     * and the other singletons (alerts unregistered, the widget key revoked, Firebase signed out): [BusinessRemoval].
     */
    suspend fun remove(id: String) {
        val s = store ?: return
        val gone = business(id) ?: return
        if (House.isDemo || s.list.size <= 1) return
        if (_current.value.id == id) s.list.firstOrNull { it.id != id }?.let { switchTo(it.id) }
        BusinessRemoval.signOut(gone)
        s.remove(id)
        _list.value = s.list
        Prefs.forget(id)
        erp.app.data.OutboxDisk.forget(id)
        erp.app.data.Book.drop(id)
        erp.app.data.Outbox.drop(id)
        erp.app.auth.Sessions.drop(id)
        erp.app.data.ErpApi.drop(id)
        // The default Firebase app cannot be deleted while the app runs; a named one can.
        if (gone.id != buildId) runCatching { FirebaseApp.getApps(app!!).firstOrNull { it.name == appName(gone) }?.delete() }
    }

    // MARK: Switching

    /**
     * Opens another business. Everything that belonged to the one left is let go (its books, its session, the stores that hold
     * one business's data), and every Activity rebuilds on the new one ([generation]), so every screen starts from nothing.
     * Each business's sign-in stays: coming back needs no Google sheet. What the business left still has on its way (an Outbox
     * entry) is sent to its own server with its own token.
     */
    fun switchTo(id: String) {
        if (House.isDemo || id == _current.value.id) return
        val next = business(id) ?: return
        val left = _current.value
        // Work still waiting for its moment in Drafts is sent now, to the business it was typed in.
        WorkDraftSync.flushAll(left.id)
        Prefs.putString(Prefs.BUSINESS_CURRENT, id)
        erp.app.data.Book.leave(left)
        erp.app.auth.Sessions.deactivate(left.id)
        _current.value = next
        resetPerBusinessState()
        applyToCore()
        // The next business's session now, from its cached answer (as a cold start opens), not while the screen is drawn.
        erp.app.auth.Sessions.of(next)
        _generation.value += 1
    }

    /** The singletons that hold one business's data: replaced or emptied, so work still in flight for the business left lands where nobody reads. */
    private fun resetPerBusinessState() {
        erp.app.data.OnlineInbox.clear()
        erp.app.screens.orders.OnlineOrdersStore.clear()
        erp.app.screens.design.DesignHooks.reset()
        WorkDraftSync.order.reset()
        WorkDraftSync.sale.reset()
        closeSheet()
    }

    /** core knows no business: the New order / New sale rules learn the open one's metal and margin here. */
    fun applyToCore() {
        val b = current
        erp.core.entry.EntryHouse.id = b.id
        erp.core.entry.EntryHouse.metalOverride = b.metal
        erp.core.entry.EntryHouse.marginOverride = b.margin.settings
    }

    // MARK: Refreshing

    /**
     * Asks every business to describe itself again, quietly: a new colour, name, logo or switch arrives without an app update.
     * Anything that fails or looks wrong leaves what the phone has. Never moves a business's address.
     */
    suspend fun refresh() {
        if (House.isDemo) return
        val s = store ?: return
        for (old in _list.value) {
            val answer = runCatching { fetch(old.serverURL + "/api/app/business") }.getOrNull() ?: continue
            if (answer.status != 200 || answer.finalHost.lowercase() != old.host) continue
            val fresh = Business.decode(answer.body) ?: continue
            val named = Business.hostOf(fresh.serverURL)
            if (fresh.id != old.id || (named != old.host && named != BusinessRules.twin(old.host))) continue
            val merged = BusinessRules.keepingIdentity(old, fresh.copy(serverURL = old.serverURL))
            if (merged.problem != null || merged == old) continue
            s.replace(merged)
            if (_current.value.id == old.id) _current.value = merged
        }
        _list.value = s.list
        erp.app.device.WidgetLinker.sync(s.list)
    }

    private var refreshed = false

    /** Once per process, a little after the launch: the businesses describe themselves again, not racing its first frame. */
    suspend fun refreshOnce() {
        if (refreshed) return
        refreshed = true
        kotlinx.coroutines.delay(2_000)
        refresh()
    }

    // MARK: Cold-start picker

    /** Settings > Businesses > "Ask which business at launch": on unless the person turned it off. */
    var askAtLaunch: Boolean
        get() = Prefs.bool(Prefs.ASK_AT_LAUNCH) ?: true
        set(value) = Prefs.putBool(Prefs.ASK_AT_LAUNCH, value)

    // MARK: Firebase, one app per business

    /** Firebase options for this business's project; null until its Android app is registered there (the sign-in page then says so). */
    fun firebaseOptions(b: Business): FirebaseOptions? {
        val a = b.android ?: return null
        val f = a.firebase
        if (!f.appId.contains(":android:")) return null
        return FirebaseOptions.Builder()
            .setApplicationId(f.appId)
            .setApiKey(f.apiKey)
            .setProjectId(f.projectId)
            .setGcmSenderId(f.senderId)
            .setStorageBucket(f.storageBucket)
            .build()
    }

    /** The business's Firebase app, made the first time it is asked for. Null in the demo, or until its Android app is registered. */
    @Synchronized
    fun firebaseApp(b: Business): FirebaseApp? {
        val context = app ?: return null
        if (House.isDemo || b.isDemo) return null
        val options = firebaseOptions(b) ?: return null
        val name = appName(b)
        FirebaseApp.getApps(context).firstOrNull { it.name == name }?.let { return it }
        return FirebaseApp.initializeApp(context, options, name)
    }

    fun auth(b: Business): FirebaseAuth? = firebaseApp(b)?.let { FirebaseAuth.getInstance(it) }

    private val configured: MutableSet<FirebaseFirestore> = Collections.newSetFromMap(IdentityHashMap())

    /**
     * The business's Firestore with the phone's own copy on disk (so the app opens with yesterday's books and no connection).
     * Settings can only be given before an instance is first used, so they are set when this finds an instance it has not set up
     * (a fresh one after `FirestoreSource.forget`).
     */
    @Synchronized
    fun firestore(b: Business): FirebaseFirestore? {
        val a = firebaseApp(b) ?: return null
        val db = FirebaseFirestore.getInstance(a)
        if (configured.add(db)) {
            db.firestoreSettings = FirebaseFirestoreSettings.Builder()
                .setLocalCacheSettings(PersistentCacheSettings.newBuilder().setSizeBytes(512L * 1024 * 1024).build())
                .build()
        }
        return db
    }

    /** The open business's own. */
    val auth: FirebaseAuth? get() = auth(current)
    val firestore: FirebaseFirestore? get() = firestore(current)

    /**
     * The email signed in to a business, from its Firebase app. `create = false` never makes an app that is not there yet: the
     * cold-start picker asks that way (a launch's cost is the open business's, not every business's).
     */
    fun signedInEmail(b: Business, create: Boolean = true): String? {
        val context = app ?: return null
        if (House.isDemo) return null
        val exists = FirebaseApp.getApps(context).any { it.name == appName(b) }
        if (!create && !exists) return null
        return auth(b)?.currentUser?.let { it.email ?: "Signed in" }
    }

    /** Businesses with somebody signed in on this phone (their push registration, their widget). */
    fun signedInBusinesses(): List<Business> = _list.value.filter { auth(it)?.currentUser != null }
}
