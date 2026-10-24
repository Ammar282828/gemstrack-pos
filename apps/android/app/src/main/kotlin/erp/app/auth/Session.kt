package erp.app.auth

import android.app.Activity
import android.content.Context
import androidx.compose.runtime.staticCompositionLocalOf
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.OAuthProvider
import erp.app.ErpApp
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.Book
import erp.app.data.ErpApi
import erp.app.data.FirestoreSource
import erp.app.data.OnlineInbox
import erp.app.device.DeviceLinks
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/** `@Environment(Session.self)`. */
val LocalSession = staticCompositionLocalOf<Session> { error("No Session provided") }

/**
 * Who is signed in and what they are to one business (the ERP says: /api/app/me). Owners get the whole app; a
 * karigar gets their work portal; anyone else is signed out again with the reason. One per business, made for the open
 * one (`Sessions`): Firebase keeps each business's sign-in in its own app, so every business stays signed in independently.
 */
class Session(private val context: Context, val business: Business) {
    enum class State { Starting, SignedOut, SigningIn, SignedIn, NeedsSetup }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(State.Starting)
    val state: StateFlow<State> = _state.asStateFlow()
    private val _me = MutableStateFlow<Me?>(null)
    val me: StateFlow<Me?> = _me.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    /** This business's own ERP and books: never the open business's, whichever that is by the time a call lands. */
    private val api: ErpApi get() = ErpApi.forBusiness(business)
    private val book: Book get() = Book.of(business)

    /** This business's Firebase sign-in (null in the demo, or until its Android app is registered). */
    private fun auth(): FirebaseAuth? = Businesses.auth(business)

    /** Stops what this session started (a switch drops the one left). */
    fun close() { scope.cancel() }

    val role: String get() = _me.value?.role ?: "none"
    val isOwner: Boolean get() = role == "owner"

    /** The business's settings for the screens (see Shop). */
    val shop: Shop get() = _me.value?.shop ?: Shop.fallbackFor(business)

    /**
     * The first frame is the app itself, not a wait: the demo, and anyone the ERP answered for last time (the same
     * answer the app already opens on offline), start signed in, so a cold start draws the shop's own pages (their
     * skeletons while the books arrive) straight after the launch screen. `start()` then checks Firebase's sign-in
     * and asks the ERP again; a changed role or a removed account is applied as soon as it answers.
     */
    init {
        val last = lastMe
        if (House.isDemo) {
            _me.value = Me("owner@example.com", "owner", null, Shop.demo(business))
            book.signedIn("owner")
            _state.value = State.SignedIn
        } else if (Businesses.firebaseOptions(business) == null) {
            _state.value = State.NeedsSetup
        } else if (last != null && last.role != "none") {
            _me.value = last
            book.signedIn(last.role)
            _state.value = State.SignedIn
        }
        scope.launch { start() }
    }

    suspend fun start() {
        if (House.isDemo) return
        if (Businesses.firebaseApp(business) == null) { _state.value = State.NeedsSetup; return }
        val user = awaitUser()
        if (user == null) {
            // Opened on the cached answer, but Firebase has nobody signed in: back to the sign-in page.
            if (_me.value != null) { _me.value = null; lastMe = null; book.signedOut() }
            _state.value = State.SignedOut
            return
        }
        val mine = _me.value
        if (mine != null && !mine.email.equals(user.email, ignoreCase = true)) {
            // The cached answer was someone else's: show nothing of theirs while the ERP is asked.
            _me.value = null
            book.signedOut()
            _state.value = State.Starting
        }
        loadMe()
    }

    /** Starts the Google sheet over `activity`; the work outlives the screen that asked. */
    fun signIn(activity: Activity) {
        scope.launch { signInNow(activity) }
    }

    private suspend fun signInNow(activity: Activity) {
        val auth = auth()
        if (auth == null) { _state.value = State.NeedsSetup; return }
        _state.value = State.SigningIn
        _error.value = null
        try {
            val t = GoogleAuth.signIn(activity)
            auth.signInWithCredential(GoogleAuthProvider.getCredential(t.idToken, null)).await()
            loadMe()
        } catch (e: CancellationException) {
            throw e
        } catch (e: GoogleAuth.Failure) {
            if (e.code != "cancelled") _error.value = e.message
            _state.value = State.SignedOut
        } catch (e: Exception) {
            _error.value = say(e)
            _state.value = State.SignedOut
        }
    }

    /**
     * Google through the browser: Firebase's own sign-in page in a Custom Tab, the same Firebase user. It needs no
     * Android OAuth client, so it works when the account sheet is refused (a key Google has not taken up yet).
     */
    fun signInThroughBrowser(activity: Activity) {
        scope.launch {
            val auth = auth()
            if (auth == null) { _state.value = State.NeedsSetup; return@launch }
            _state.value = State.SigningIn
            _error.value = null
            try {
                val provider = OAuthProvider.newBuilder("google.com")
                    .addCustomParameter("prompt", "select_account")
                    .setScopes(listOf("email", "profile"))
                    .build()
                (auth.pendingAuthResult ?: auth.startActivityForSignInWithProvider(activity, provider)).await()
                loadMe()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _error.value = say(e)
                _state.value = State.SignedOut
            }
        }
    }

    private suspend fun loadMe() {
        try {
            val me = Me.from(api.get("/api/app/me")) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
            if (me.role == "none") {
                _error.value = "${me.email} isn't on ${business.displayName}'s list. Ask the shop to add this Gmail."
                signOut()
                return
            }
            _me.value = me
            lastMe = me
            book.signedIn(me.role)
            _state.value = State.SignedIn
            if (me.role == "owner") DeviceLinks.afterSignIn(business)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // The ERP refused the sign-in and Google says the account itself is gone or disabled: not "offline".
            if (e is ErpApi.Failure && (e.status == 401 || e.status == 403) && accountGone()) {
                _error.value = "This sign-in is no longer valid. Sign in again."
                signOut(unregister = false)
                return
            }
            // No answer (offline, or the server restarting): stay signed in as the ERP last said.
            val last = lastMe
            if (last != null && last.email.equals(currentUser()?.email, ignoreCase = true)) {
                _me.value = last
                book.signedIn(last.role)
                _state.value = State.SignedIn
            } else {
                _error.value = say(e)
                _state.value = State.SignedOut
            }
        }
    }

    /** `unregister = false` when Google already refused the account: its token can't delete anything. */
    fun signOut(unregister: Boolean = true) {
        // The screen leaves at once; the phone is unregistered for alerts while its sign-in token is still good
        // (after Firebase's sign-out the request would go without one, be refused, and alerts would keep coming).
        lastMe = null
        book.signedOut()
        OnlineInbox.clear()
        _me.value = null
        _state.value = State.SignedOut
        val leaving = currentUser()?.uid
        // Not this session's scope: a switch of business right after must not cancel the sign-out half done.
        ErpApp.scope.launch {
            // Never waits more than a few seconds: offline, the sign-out must still happen.
            withTimeoutOrNull(3_500) { DeviceLinks.beforeSignOut(unregister, business) }
            // Only the account that was leaving: a quick sign-in again meanwhile is not undone.
            if (currentUser()?.uid == leaving) auth()?.signOut()
            val s = _state.value
            if (s != State.SignedIn && s != State.SigningIn) GoogleAuth.signOut(context)
            // The owner's books stay on no phone after sign-out: Firestore's copy on disk is erased too.
            if (_state.value == State.SignedOut) FirestoreSource.forget(business)
        }
    }

    /** The Firebase ID token the ERP's server routes check. */
    suspend fun idToken(): String? {
        if (House.isDemo) return null
        return try { currentUser()?.getIdToken(false)?.await()?.token } catch (e: Exception) { null }
    }

    private fun currentUser(): FirebaseUser? = auth()?.currentUser

    /** Android restores a signed-in user a moment after Firebase starts: the first auth-state callback is the answer. */
    private suspend fun awaitUser(): FirebaseUser? = suspendCancellableCoroutine { cont ->
        val auth = auth() ?: run { cont.resumeWith(Result.success(null)); return@suspendCancellableCoroutine }
        val listener = object : FirebaseAuth.AuthStateListener {
            override fun onAuthStateChanged(a: FirebaseAuth) {
                a.removeAuthStateListener(this)
                if (cont.isActive) cont.resumeWith(Result.success(a.currentUser))
            }
        }
        auth.addAuthStateListener(listener)
        cont.invokeOnCancellation { auth.removeAuthStateListener(listener) }
    }

    /** The last answer, for opening with no connection: one per business (`erp.lastMe.<id>`). */
    private var lastMe: Me?
        get() = Me.fromJson(Prefs.string(LAST_ME_KEY, business.id))
        set(value) = Prefs.putString(LAST_ME_KEY, value?.toJson(), business.id)

    /**
     * Whether a refusal means the account is really over: a forced token refresh that Firebase rejects for the
     * user (disabled, deleted, its token revoked). A network failure is not that.
     */
    private suspend fun accountGone(): Boolean {
        val user = currentUser() ?: return true
        return try {
            user.getIdToken(true).await()
            false
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            (e as? FirebaseAuthException)?.errorCode in GONE
        }
    }

    companion object {
        private val GONE = setOf("ERROR_USER_DISABLED", "ERROR_USER_NOT_FOUND", "ERROR_USER_TOKEN_EXPIRED", "ERROR_INVALID_USER_TOKEN")

        /** The last answer of one business, for opening with no connection: the role is the server's, never assumed. */
        private const val LAST_ME_KEY = "erp.lastMe"

        fun forgetLastMe(businessId: String) = Prefs.remove(LAST_ME_KEY, businessId)

        fun say(error: Throwable): String = when {
            error is FirebaseNetworkException -> say("ERROR_NETWORK_REQUEST_FAILED") ?: plain(error)
            error is FirebaseTooManyRequestsException -> say("ERROR_TOO_MANY_REQUESTS") ?: plain(error)
            error is FirebaseAuthException -> say(error.errorCode) ?: plain(error)
            else -> plain(error)
        }

        /** Firebase's error codes in the shop's words; null for the rest. */
        fun say(code: String): String? = when (code) {
            "ERROR_NETWORK_REQUEST_FAILED" -> "No connection to Google. Check the internet and try again."
            "ERROR_ADMIN_RESTRICTED_OPERATION" -> "This Google account hasn't been let in yet: the shop has to allow new sign-ins first."
            "ERROR_TOO_MANY_REQUESTS" -> "Too many tries. Wait a minute, then try again."
            else -> null
        }

        private fun plain(e: Throwable) = e.message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Try again."
    }
}
