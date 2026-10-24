package erp.app.device

import android.app.Activity
import android.content.Context
import android.view.ViewGroup
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import erp.app.R
import erp.app.config.House
import erp.app.config.Prefs
import kotlin.coroutines.resume
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The shop's books are on this phone: the app asks for the fingerprint (or the phone's screen lock) when it
 * comes back after being away, and never lets the recents screen's snapshot show a figure.
 *
 * On by default for an owner on a phone with a screen lock; switched in Search → This phone. A minute away is
 * allowed without asking again (a customer's call, a photo from the camera).
 */
object AppLock {
    private const val ENABLED_KEY = "erp.lock.enabled"
    const val GRACE_MS = 60_000L
    private val AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL

    private val _locked = MutableStateFlow(false)
    /** The app is behind the lock screen. */
    val locked: StateFlow<Boolean> = _locked.asStateFlow()
    private val _covered = MutableStateFlow(false)
    /** The recents screen is about to photograph the app: cover it. */
    val covered: StateFlow<Boolean> = _covered.asStateFlow()
    private val _unlocking = MutableStateFlow(false)
    val unlocking: StateFlow<Boolean> = _unlocking.asStateFlow()
    private var leftAt: Long? = null
    // Pages are Activities: the app is "in the background" only when none of them is resumed.
    private var front = 0

    var enabled: Boolean
        get() = Prefs.bool(ENABLED_KEY) ?: true
        set(value) = Prefs.putBool(ENABLED_KEY, value)

    /** Whether this phone can lock at all (a screen lock is set). */
    fun available(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

    /** The window is leaving the front (onPause): the recents snapshot must show nothing. */
    fun paused(signedIn: Boolean) {
        front = (front - 1).coerceAtLeast(0)
        if (House.isDemo) return
        // Between two of our pages nothing is in front for a moment: covering then flashed the logo on every
        // open and Back. Android 13+ keeps the app out of the recents snapshot itself (applyRecentsPolicy), so the
        // cover waits for onStop there; older phones still need it here, before the snapshot is taken.
        if (front == 0 && android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.TIRAMISU) _covered.value = signedIn
    }

    /** Fully in the background (onStop). */
    fun stopped(signedIn: Boolean, now: Long = System.currentTimeMillis()) {
        if (House.isDemo || front > 0) return // another page of ours is in front: this one only went under it
        _covered.value = signedIn
        if (leftAt == null) leftAt = now
    }

    /** Back in front (onResume). */
    fun resumed(context: Context, signedIn: Boolean, now: Long = System.currentTimeMillis()) {
        front++
        if (House.isDemo) return
        _covered.value = false
        val left = leftAt
        if (signedIn && enabled && available(context) && left != null && shouldLock(left, now)) _locked.value = true
        leftAt = null
    }

    /**
     * A cold start of a signed-in app asks too. The cover is up from the first frame; the prompt is asked for
     * once the app is in front (`unlockIfNeeded`).
     */
    fun launched(context: Context, signedIn: Boolean) {
        if (House.isDemo || !signedIn || !enabled || !available(context)) return
        _locked.value = true
    }

    /** Nobody is signed in after all (the cached sign-in was gone): there is nothing to lock away. */
    fun signedOut() { _locked.value = false }

    internal fun shouldLock(leftAt: Long, now: Long) = now - leftAt > GRACE_MS

    suspend fun unlockIfNeeded(activity: androidx.fragment.app.FragmentActivity) {
        if (_locked.value) unlock(activity)
    }

    suspend fun unlock(activity: androidx.fragment.app.FragmentActivity) {
        if (!_locked.value || _unlocking.value) return
        _unlocking.value = true
        try {
            val ok = suspendCancellableCoroutine { cont ->
                val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { if (cont.isActive) cont.resume(true) }
                    // Cancelled or failed: the lock screen stays, with its button to try again.
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { if (cont.isActive) cont.resume(false) }
                })
                cont.invokeOnCancellation { prompt.cancelAuthentication() }
                prompt.authenticate(
                    BiometricPrompt.PromptInfo.Builder()
                        .setTitle("Open ${House.storeName}")
                        .setAllowedAuthenticators(AUTHENTICATORS)
                        .build(),
                )
            }
            if (ok) _locked.value = false
        } finally {
            _unlocking.value = false
        }
    }

    /** Keeps the recents screen blank while there is something to hide (API 33+; older phones get the cover only). */
    fun applyRecentsPolicy(activity: Activity, hide: Boolean) {
        if (android.os.Build.VERSION.SDK_INT >= 33) activity.setRecentsScreenshotEnabled(!hide)
    }
}

/** What shows over the app while it is locked or being photographed for recents: the house's mark on its ground, nothing of the books. */
@Composable
fun LockCover(locked: Boolean, unlocking: Boolean, onUnlock: () -> Unit) {
    // A ModalBottomSheet and a Dialog live in windows of their own, above the activity's content: a cover drawn in
    // the content would sit under an open sheet and show the books over the lock. The cover is a window too, added
    // after them, so it is above every one of them; Back does not dismiss it.
    Dialog(
        onDismissRequest = {},
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false, usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        (LocalView.current.parent as? DialogWindowProvider)?.window?.let { w ->
            SideEffect {
                w.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                w.setDimAmount(0f)
                w.setBackgroundDrawableResource(android.R.color.transparent)
            }
        }
        LockCoverBody(locked, unlocking, onUnlock)
    }
}

@Composable
private fun LockCoverBody(locked: Boolean, unlocking: Boolean, onUnlock: () -> Unit) {
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Image(
                painterResource(R.drawable.brand_logo),
                contentDescription = stringResource(R.string.app_name),
                modifier = Modifier.widthIn(max = 280.dp),
            )
            if (locked) Button(onClick = onUnlock, enabled = !unlocking) { Text("Unlock") }
        }
    }
}
