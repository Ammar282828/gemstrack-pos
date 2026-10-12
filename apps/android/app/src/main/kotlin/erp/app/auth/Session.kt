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
import erp.app.ErpApp
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
 * Who is signed in and what they are to this house (the ERP says: /api/app/me). Owners get the whole app; a
 * karigar gets their work portal; anyone else is signed out again with the reason.
 */
class Session(private val context: Context) {
    enum class State { Starting, SignedOut, SigningIn, SignedIn, NeedsSetup }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _state = MutableStateFlow(State.Starting)
    val state: StateFlow<State> = _state.asStateFlow()
    private val _me = MutableStateFlow<Me?>(null)
    val me: StateFlow<Me?> = _me.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    val role: String get() = _me.value?.role ?: "none"
    val isOwner: Boolean get() = role == "owner"

    /** The house's settings for the screens (see Shop). */
    val shop: Shop get() = _me.value?.shop ?: Shop.fallback(House.id)

    /**
     * The first frame is the app itself, not a wait: the demo, and anyone the ERP answered for last time (the same
     * answer the app already opens on offline), start signed in, so a cold start draws the shop's own pages (their
     * skeletons while the books arrive) straight after the launch screen. `start()` then checks Firebase's sign-in
     * and asks the ERP again; a changed role or a removed account is applied as soon as it answers.
     */
    init {
        val last = lastMe
        if (House.isDemo) {
            _me.value = Me("owner@example.com", "owner", null, Shop.demo(House.id))
            Book.shared.signedIn("owner")
            _state.value = State.SignedIn
        } else if (House.firebaseOptions == null) {
            _state.value = State.NeedsSetup
        } else if (last != null && last.role != "none") {
            _me.value = last
            Book.shared.signedIn(last.role)
            _state.value = State.SignedIn
        }
        scope.launch { start() }
    }

    suspend fun start() {
        if (House.isDemo) return
        if (!ErpApp.ensureFirebase()) { _state.value = State.NeedsSetup; return }
        val user = awaitUser()
        if (user == null) {
            // Opened on the cached answer, but Firebase has nobody signed in: back to the sign-in page.
            if (_me.value != null) { _me.value = null; lastMe = null; Book.shared.signedOut() }
            _state.value = State.SignedOut
            return
        }
        val mine = _me.value
        if (mine != null && !mine.email.equals(user.email, ignoreCase = true)) {
            // The cached answer was someone else's: show nothing of theirs while the ERP is asked.
            _me.value = null
            Book.shared.signedOut()
            _state.value = State.Starting
        }
        loadMe()
    }

    /** Starts the Google sheet over `activity`; the work outlives the screen that asked. */
    fun signIn(activity: Activity) {
        scope.launch { signInNow(activity) }
    }

    private suspend fun signInNow(activity: Activity) {
        if (!ErpApp.ensureFirebase()) { _state.value = State.NeedsSetup; return }
        _state.value = State.SigningIn
        _error.value = null
        try {
            val t = GoogleAuth.signIn(activity)
            FirebaseAuth.getInstance().signInWithCredential(GoogleAuthProvider.getCredential(t.idToken, null)).await()
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

    private suspend fun loadMe() {
        try {
            val me = Me.from(ErpApi.shared.get("/api/app/me")) ?: throw ErpApi.Failure(0, "The ERP's answer couldn't be read.")
            if (me.role == "none") {
                _error.value = "${me.email} isn't on ${House.storeName}'s list. Ask the shop to add this Gmail."
                signOut()
                return
            }
            _me.value = me
            lastMe = me
            Book.shared.signedIn(me.role)
            _state.value = State.SignedIn
            if (me.role == "owner") DeviceLinks.afterSignIn()
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
                Book.shared.signedIn(last.role)
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
        Book.shared.signedOut()
        OnlineInbox.clear()
        _me.value = null
        _state.value = State.SignedOut
        val leaving = if (ErpApp.firebaseReady) currentUser()?.uid else null
        scope.launch {
            // Never waits more than a few seconds: offline, the sign-out must still happen.
            withTimeoutOrNull(3_500) { DeviceLinks.beforeSignOut(unregister) }
            // Only the account that was leaving: a quick sign-in again meanwhile is not undone.
            if (ErpApp.firebaseReady && currentUser()?.uid == leaving) FirebaseAuth.getInstance().signOut()
            val s = _state.value
            if (s != State.SignedIn && s != State.SigningIn) GoogleAuth.signOut(context)
            // The owner's books stay on no phone after sign-out: Firestore's copy on disk is erased too.
            if (_state.value == State.SignedOut) FirestoreSource.forget()
        }
    }

    /** The Firebase ID token the ERP's server routes check. */
    suspend fun idToken(): String? {
        if (House.isDemo || !ErpApp.firebaseReady) return null
        return try { currentUser()?.getIdToken(false)?.await()?.token } catch (e: Exception) { null }
    }

    private fun currentUser(): FirebaseUser? = if (ErpApp.firebaseReady) FirebaseAuth.getInstance().currentUser else null

    /** Android restores a signed-in user a moment after Firebase starts: the first auth-state callback is the answer. */
    private suspend fun awaitUser(): FirebaseUser? = suspendCancellableCoroutine { cont ->
        val auth = FirebaseAuth.getInstance()
        val listener = object : FirebaseAuth.AuthStateListener {
            override fun onAuthStateChanged(a: FirebaseAuth) {
                a.removeAuthStateListener(this)
                if (cont.isActive) cont.resumeWith(Result.success(a.currentUser))
            }
        }
        auth.addAuthStateListener(listener)
        cont.invokeOnCancellation { auth.removeAuthStateListener(listener) }
    }

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

        /** The last answer, for opening with no connection: the role is the server's, never assumed. */
        private const val LAST_ME_KEY = "erp.lastMe"
        private var lastMe: Me?
            get() = Me.fromJson(Prefs.string(LAST_ME_KEY))
            set(value) = Prefs.putString(LAST_ME_KEY, value?.toJson())

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
